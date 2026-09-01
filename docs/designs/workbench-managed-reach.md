# Workbench: reaching a managed database without joining its network

Status: built, 2026-09-01. `packages/api/src/data/tunnel.ts` (the relay),
`packages/api/src/data/session.ts` (the registry), `routers/data/sessions.ts`
(open / close / list), `apps/web/.../data/use-workbench-session.ts` +
`components/connect-gate.tsx` + `components/target-picker.tsx` (the flow).
Verified on a managed `postgres:18-alpine`: open 78 ms, a query 31 ms with
`inet_server_addr() = 127.0.0.1`, disconnect leaves no relay and no listener.

One finding changed the relay's order of preference: BusyBox `cat` (Alpine)
holds its output until EOF, so the bash form is the LAST resort; `nc`, then
`socat`, come first (both forward each read at once). Checked on
`postgres:18-alpine` (nc), `mariadb:11` (socat), `mysql:8` (bash + GNU cat).

## What is broken, with evidence

On `overwatch` (a plain-Docker, single-node install) the workbench cannot open
a managed database. The server's own error, once the reason was surfaced:

    shared/postgres (postgres.shared.otterdeploy.internal:5432): Connection closed

From inside the control-plane container:

    getent hosts postgres.shared.otterdeploy.internal   -> nothing

From a throwaway container on the project's network `otterdeploy-shared`:

    postgres.shared.otterdeploy.internal (10.0.2.12:5432) open

So the database is fine. `resolveManagedTarget` (`packages/api/src/data/target.ts`)
uses the service's DNS alias on the *project* network and its comment says "the
control plane is on that network". It is not, and never was: project networks
are created per deploy (`ensureBridgeNetwork` / `ensureProjectNetwork`), the
edge Caddy is attached to them dynamically (`connectCaddyToNetwork`,
`ensureEdgeOnProjectNetworks`), and nothing attaches the server container.
Managed targets in the workbench have never worked on this path; only external
connection strings did.

(The Neon timeout on the same box is a different fault: a pre-2026-07-27
`DOCKER-USER` guard rule without `ct status dnat` dropping all container
egress off 80/443/3000. Tracked as od-v1cu; not part of this design.)

## Why not just attach the control plane (rejected)

The obvious fix, mirroring the Caddy self-heal, is to `docker network connect`
the server container to every project network. The owner rejected it, for
reasons that hold:

- **Blast radius.** The control plane would sit on every tenant network with
  the Docker socket mounted. Any project container could reach `:3000` on it
  by IP. Today a project network contains only that project's services and
  the edge.
- **Name clashes.** Every project publishes bare aliases (`postgres`, `redis`).
  A container on N project networks gets N answers for `postgres`. We resolve
  the qualified `<svc>.<project>.otterdeploy.internal`, but every other lookup
  the process makes now depends on Docker's tie-breaking.
- **Permanence.** Attachments outlive the session that needed them and have to
  be re-applied after every container recreate; a self-heal loop for a thing
  we did not want in the first place.

## How the old project Data tab did it

`packages/api/src/routers/database/query.ts` never touched the network: it
found the database's container (`findResourceContainerId`) and ran
`psql --csv -v ON_ERROR_STOP=1 -c <sql>` inside it with `docker exec`
(`execCapture`, `packages/api/src/backups/exec.ts`), with a read-only
`PGOPTIONS`. Stats, tenancy admin (`tenancy.ts`), backups and verify-restore
all use the same exec channel. Exec needs only the Docker socket, which the
control plane already has, and it works identically under swarm (exec runs on
the node that has the task) and plain Docker.

The workbench did not adopt that path because it wants what a real driver
gives: typed columns, cancellation, `LIMIT`-less streaming into the grid,
transactions for edits, one pooled connection per tab. `psql --csv` flattens
all of that to strings.

## Proposal: a per-session exec tunnel

Keep the driver. Move the *transport* to exec.

    workbench tab ──rpc──> control plane
                              │  new SQL({ hostname: 127.0.0.1, port: P })
                              ▼
                     127.0.0.1:P  (Bun.listen, loopback, one per session)
                              │  bytes both ways
                              ▼
        docker exec -i <db-container> bash -c
          'exec 3<>/dev/tcp/127.0.0.1/5432; cat <&3 & cat >&3; wait'
                              │  inside the database container
                              ▼
                       postgres on 127.0.0.1:5432

- **No network membership, no aliases, nothing to clean up on the network.**
  The only thing that exists is a loopback listener in the control plane and
  one exec in the database container; both die with the session.
- **Same trust as today.** Exec into a container we already exec into for
  backups and stats. The listener binds `127.0.0.1` only, so nothing outside
  the control-plane container can use the tunnel.
- **Swarm and plain Docker alike.** Exec is the one primitive that works the
  same on both drivers, which is why the rest of the platform uses it.
- **The Docker client already supports it.** `@otterdeploy/docker` exposes
  `dialHijack` (a bidirectional `net.Socket` over the API) and the server
  image ships the `docker` CLI (`host-shell.ts` spawns it). Either carries the
  exec's stdin/stdout. Start with `Bun.spawn(["docker","exec","-i",…])` for
  the first cut: `ReadableStream` in, `WritableStream` out, no framing to
  parse (with `Tty: false` the API multiplexes stdout/stderr and needs the
  8-byte header stripped; the CLI does that for us).

Engine notes: the official Postgres, MySQL, MariaDB and Mongo images ship
bash, so `/dev/tcp` is available; the Alpine variants (Redis) have BusyBox
`nc`, so the relay command is chosen per image: `bash -c 'exec 3<>/dev/tcp/…'`
when bash is present, else `nc 127.0.0.1 <port>`. Probe once per session
(`command -v bash`), never per query.

## Session model (what the owner asked for)

Today the workbench auto-opens a target when the page loads. Instead:

1. **Enter the Workbench:** the rail lists every target (managed resources and
   saved connections) with no session open. Nothing connects on its own.
2. **Click a target:** a "Connecting…" state on that row. The server opens a
   session: for a managed target it starts the tunnel above and a pool bound
   to `127.0.0.1:P`; for an external target it is the existing pool. First
   query is the schema read. The row becomes "Connected".
3. **Work:** every RPC carries the session id (today: target + mode). The pool
   key becomes `session:<id>:<mode>` so read-only and read-write never share
   a socket, as now.
4. **Disconnect** (button on the row, closing the last tab of that target, or
   leaving the Workbench): the server closes the pool, ends the exec, closes
   the listener, drops the session. The row returns to idle.
5. **Idle:** a session with no RPC for 10 minutes is torn down the same way;
   the client shows "Disconnected (idle)" and the row is clickable again. The
   `POOL_TTL_MS` reaper in `pool.ts` already does this for pools; the tunnel
   hangs off the same lifecycle.
6. **Boot / crash:** sessions are in-memory only. On boot, sweep any exec the
   control plane left behind is unnecessary (an exec dies with its parent
   process), and loopback listeners die with the process. Nothing persists.

Concurrency: two users opening the same managed database get two sessions
and two tunnels. Cheap (one exec each), and it keeps the "disconnect cleans
up *my* thing" promise true without reference counting.

## API sketch

    data.session.open    { target }              -> { sessionId, engine, label }
    data.session.close   { sessionId }           -> {}
    data.session.list    {}                      -> [{ sessionId, target, since, idleFor }]
    data.schema / data.run / data.rows / …       { sessionId, … }   (today: { target, … })

`resolveManagedTarget` returns `host: "127.0.0.1", port: P` for a live session
instead of the alias; `pool.ts` is unchanged. Sessions live in a
`Map<sessionId, { target, tunnel, lastUsedAt }>` next to the pool map.

## Cost

Opening a session costs one `docker exec` (~100–300 ms) plus the driver's
handshake; that is the "loading thing" the owner described and it happens
once per session, not per query. Steady-state per-query overhead is the
loopback hop and two `cat`s: negligible against the query itself.

## Out of scope

- Public/TLS access on :443 (`db-tls-multiplex-443.md`) is for clients outside
  the cluster and stays separate.
- The `DOCKER-USER` guard drift (od-v1cu).
