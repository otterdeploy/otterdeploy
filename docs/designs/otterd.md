# otterd: the per-server daemon (and, in time, the only runtime)

Status: direction agreed 2026-09-01. Supersedes the "unified image, different
entrypoint" decision in `server-health-agent.md` once phase 1 ships; the
ingest contract, tables, read routes and UI from that doc stay.

Reference clone: Beszel `b38fb7d` (v0.18.8, MIT) at `/tmp/beszel`. Not
vendored: 35.7k LOC of Go. Re-clone with
`git clone --depth 1 https://github.com/henrygd/beszel /tmp/beszel`.

## Why

What ships today (PRs #162, #163) already collects most of what Beszel
collects: CPU total/breakdown/per-core, load, memory with swap/cache/ARC,
every filesystem, per-device disk I/O, per-interface network, docker df,
ZFS pool, systemd units (`packages/api/src/system-health/*`). The read
side (`server.health`, `server.metrics`, `server.units`), the tables
(`server_health_sample`, `server_metric`, `server_unit`) and the fleet
cards exist. That is not the problem.

The problem is **what runs on the node**:

| | today | Beszel agent |
|---|---|---|
| artifact on every node | the whole unified server image (bun + monorepo, ~1 GB pull) | one static binary in a `FROM scratch` image |
| runtime | `bun run src/health-agent.ts`, 256 MB cap | ~10-15 MB RSS |
| install | only as a swarm global service; `DEPLOY_RUNTIME=swarm` only | `curl \| sh` → systemd unit, or compose, or Helm, or swarm |
| identity | one shared HMAC bearer for the whole swarm, 1-year TTL, plain HTTP | per-node ed25519 key, mutual auth, TLS |
| cadence | agent-owned 60 s push, control plane can only wait | hub-owned: 60 s history + 1 s realtime over the same connection |
| commands | none (design doc phase 2: "piggyback on the report") | typed request/response: data, logs, inspect, smart, systemd |
| node down | "stale" badge, no alert (od-je0h.21) | connection drop = status alert with pending timer |
| upgrades | agent recreated when the server image tag drifts | `agent update` self-update with checksum, daily timer |

And the larger reason, decided the same day: **Docker Swarm is on its way
out.** Coolify deprecated it for v5 (replacing it with compose replicas and
their own scaling), Dokploy is the last one on it, and the beads already
record pain swarm cannot fix (od-5j8.18 health-gated blue-green,
compose recreating on a tag change with an identical digest). The daemon
this doc describes is the thing that replaces it.

## Decisions

### Name: `otterd`

Binary `otterd`, unit `otterd.service`, image `ghcr.io/otterdeploy/otterd`,
source `apps/otterd`, in prose "otterd". Unix daemon convention
(`dockerd`, `containerd`, `tailscaled`); brand-owned, so it can never
collide; says nothing about *what* it does, which is right because the
job grows from metrics to runtime. Not "agent" (means nothing to a user),
not "node" (already the word for the machine), not "Sentinel" (Coolify's).

`otterd` is a different program from the operator CLI (`otd` /
`otterdeploy`), the way `dockerd` ≠ `docker`. They share nothing: the CLI
talks to the control plane as a user over oRPC and stays TypeScript
because it types itself as `AppRouterClient` straight from `packages/api`
(every new route is callable for free); the daemon talks to the control
plane as a machine over WSS. The daemon's own subcommands (`otterd
health`, `otterd update`, `otterd fingerprint`) are maintenance switches,
not the operator CLI.

### Language: Rust

Go would be the faster port (Beszel is MIT Go; `deltatracker`,
`docker.go` and the CPU math could be lifted nearly verbatim). Rust anyway:

1. otterd is the one process we put on **every customer machine**
   forever, and it will run their containers; its floor matters more than
   any other component's. Rust: ~3-6 MB RSS, no GC, ~4 MB static musl
   binary. Go: ~10-15 MB. Bun today: ~80-150 MB plus the image pull.
2. The repo has neither Go nor Rust, so there is no incumbency; the
   toolchain cost is paid once either way. `rustic` (backups) already puts
   a Rust binary in the product.
3. Every Beszel dependency has a mature crate: `procfs`/`sysinfo`
   (collectors), `bollard` (Docker API over the unix socket, typed),
   `tokio` + `tokio-tungstenite` + `rustls` (outbound WSS),
   `ed25519-dalek` (identity), `zbus` (systemd over D-Bus), `serde`,
   `cargo-dist` (release matrix + checksums + installer).

Cost to be honest about: we port Beszel's *design*, not its code, and
the collectors take ~1.5× the Go effort. Accepted.

### Destination: otterd is the only runtime driver

Not a third driver next to `dockerDriver` and `swarmDriver`
(`packages/api/src/runtime/index.ts:17-29`): the only one. A single-node
install is the multi-node system with N=1. One driver means every
feature (health-gated blue-green, replicas, logs, exec, metrics) is built
once and a single-node user gets all of it.

What that buys the user:

- Zero-downtime deploys everywhere: start-new → health gate → swap →
  stop-old on the node. Swarm's `UpdateConfig` cannot express it; plain
  docker today recreates with a blip.
- "Add a server" is one command: `otd server add` → curl one-liner → the
  server shows up with metrics and can host services. No `swarm join`,
  no manager/worker, no 2377 on the internet.
- Identical behaviour on 1 server and 5; no "needs swarm" feature gates;
  remote servers stop being read-only.
- The control plane stops needing the Docker socket: a plain web app
  that can run anywhere, including hosted later.
- Multi-node is dogfooded by every install because localhost goes
  through the same daemon.

What we are **not** building, on purpose (the parts nobody asked for):

- No auto-scheduler, bin-packing, or rescheduling on node death. A
  service is placed on a server explicitly (default: the primary). If a
  server dies the operator sees it and moves the service.
- No cross-node VIP or load balancer. Replicas live on one server behind
  the local swap; the edge (Caddy) fronts them. Cross-node
  *reachability* (app on A → DB on B) is the mesh (od-xer); cross-node
  *names* are a small control-plane DNS over mesh IPs.
- No swarm secrets/configs (env is already encrypted at rest in the DB)
  and no overlay (the mesh replaces it).

Stays out of otterd: the **builder** (BuildKit, its own worker) and
**compose parsing** (`swarm/compose.ts` already translates compose →
specs; it translates to otterd specs instead; the daemon only ever
understands "run this container spec").

The real cost is not the driver seam. `RuntimeDriver`
(`runtime/types.ts:65-106`) is 10 methods in 3 files, but **54 files call
`Docker.fromEnv()`** and only 3 are in `runtime/`: project routers (10),
server routers (8), databases + branching (7), backups (3), volumes,
terminal shell, firewall, caddy, migrate-from-Coolify, compose, orphan GC,
reclaim, log tails, image-pull progress. Each side door becomes an otterd
verb (`logs`, `exec`, `volume.*`, `snapshot`, `reclaim`, `events`) or is
declared primary-host-only. That inventory is the migration checklist.

**Swarm is frozen from today**: nothing new goes through `swarmDriver`.
It is deleted once a swarm → otterd migration command exists for the
existing installs (prod at otterstack.dev looks swarm-shaped from the
service naming and would be the first migration).

### Transport: outbound WebSocket, hub-driven cadence (Beszel mode A only)

- otterd dials `wss://<control-plane>/api/otterd/connect` and stays
  connected. The control plane owns cadence: a 60 s history tick per
  node, plus a 1-5 s realtime tick **only while someone has that server
  page open** (Beszel `system_realtime.go`).
- We do **not** port Beszel's inbound SSH mode. We own both ends, nodes
  must reach the control plane anyway, and NAT'd nodes are the common
  case. One transport, one code path.
- Wire format: JSON, parsed with zod at the boundary (repo rule). CBOR
  with integer keys is a later optimisation; at 60 s × N nodes it does
  not matter and at 1 s realtime the payload is still < 4 KB.
- Message shape mirrors Beszel `common-ws.go`: `HubRequest { id, action,
  data }` / `AgentResponse { id, ...one-of }`. Actions v1: `hello`,
  `get_data { cacheMs, includeDetails }`, `container_logs`,
  `container_info`, `reclaim { targets }`. **Reserved from v1** so the
  protocol never has to be re-cut: `apply { instances[] }`, `status`
  (streamed), `logs` (streamed), `exec`, `events`, `volume.*`,
  `snapshot`. Static `Details` (hostname, kernel, cores, model, arch,
  mem total, otterd version) travel once per connection, not per tick.

### Identity: per-node key, mutual auth, one-time enrollment (closes od-5j8.20)

Non-negotiable once otterd runs containers: a daemon that executes
`apply` on a shared bearer token is remote code execution for anyone
holding the token.

- First boot: otterd generates an ed25519 keypair in `/var/lib/otterd/`
  (Beszel `fingerprint.go` shape). Its public key is its identity; the
  fingerprint is `sha256(pubkey)[:24]` hex.
- Enrollment: `otd server add` (or the UI) mints a short-lived one-time
  join token from the existing `node_enrollment` table; the install
  one-liner carries it. otterd presents token + pubkey; the control plane
  stores the pubkey on the `server` row and the token dies.
- Every connection: otterd signs a control-plane nonce (proves node); the
  control plane signs otterd's nonce with the platform's ed25519 key,
  pinned at enrollment (proves hub; Beszel's `KEY` inverted-auth trick).
  Revocation = delete the pubkey; the socket closes on the next frame.
- TLS via the control plane's public HTTPS. **Do not port
  `InsecureSkipVerify: true`** (Beszel `client.go:135`) or the spoofed
  browser User-Agent (`client.go:301-312`).

### Storage stays on the control plane

otterd keeps no database (Dokploy's per-host SQLite is the anti-pattern:
raw rows forever, `limit=all` loads the retention window into memory, no
VACUUM). State on the node is the keypair and a `/dev/shm` health
touch-file for `otterd health` (Beszel `health.go`: liveness is the
file's mtime < 91 s; that is the whole Docker HEALTHCHECK).

Control-plane side keeps `server_metric` (host), `resource_metric`
(container), `server_health_sample` (latest snapshot for the list read),
`server_unit` (latest per unit). Add the rollup ladder from Beszel
`records.go` for od-je0h.11:

| tier | built from | retention |
|---|---|---|
| raw (30-60 s) | ingest | 24 h |
| 10m | ≥ 9 raw | 12 h → keep 48 h |
| 20m | 2 × 10m | 24 h → keep 7 d |
| 120m | 6 × 20m | 7 d → keep 30 d |
| 480m | 4 × 120m | 30 d → keep 90 d |

Each rolled row carries mean **and max** (the bead's peak-preservation
requirement; Beszel only averages, that is the one place we do better).

## What to copy from Beszel, file by file

The agent report (`/tmp/beszel/agent/`) reduces to eight patterns. Port
these; ignore the rest.

1. **Interval-keyed delta trackers** (`agent_cache.go`, `cpu.go:11-45`,
   `docker.go:74-82`). Every rate (CPU, disk, net, container CPU/net) is
   keyed by the requester's `cacheMs`. A 60 s tick and a 1 s tick coexist
   without corrupting each other's baselines; cache freshness is
   `age < cacheMs/2`. This is the whole reason hub-driven cadence works,
   and it is what makes od-3fxu (5 s container cadence) free.
2. **`DeltaTracker`** (`deltatracker/deltatracker.go`, 60 lines):
   current/previous maps, `delta(id)` = 0 when either side missing,
   `cycle()` once per pass. Generic over the key.
3. **Docker over the raw socket** (`docker.go`): `GET /containers/json`
   then per-container `GET /containers/{id}/stats?stream=0&one-shot=1`
   fanned out under a 5-wide semaphore, one retry pass for failures,
   stale entries pruned against the live id set. With `bollard` the HTTP
   plumbing is free; keep the concurrency bound and the retry pass.
   Container CPU% = `cpuDelta / systemDelta × 100` on Linux
   (`container.go:54-75`); memory = `usage - inactive_file`
   (`docker.go:260-276`); counter rollback → new baseline, never a
   wrapped subtraction. Strip `Config.Env` from inspect responses
   (`docker.go:841-843`), always.
4. **Defensive ceilings that discard the sample and re-seed**
   (`docker.go:40-44`, `network.go:216-229`, `disk.go:647-652`,
   `sensors.go:234-247`): 5 GB/s container net, 10 GB/s host net,
   50 GB/s disk, 100 TB memory, 100 % CPU, 200 °C. A wrong number is
   worse than a missing one; our current TS agent already holds that
   line (nulls on first read), keep it.
5. **Expensive things off the tick** (`systemd.go:87-92`,
   `fans.go:21`, `gpu.go:311-332`): systemd refreshes on its own 10-min
   task and the tick reads a map; sensor discovery is memoised once;
   SMART is request-driven with an agent-declared interval.
6. **Host `/proc` inside a container** (`uptime_linux.go`, our own
   `HOST_PROC_PATH`): read `/proc/1/net/dev` for the host namespace;
   `/proc/mounts` and `/proc/net/dev` are the two files that lie inside a
   container. `procfs` crate takes a root path.
7. **Details vs stats split** (`system.go:122-132`): static fields once
   per connection, marked dirty on change.
8. **Install and update story** (`supplemental/scripts/install-agent.sh`,
   `agent/update.go`, `supplemental/debian/beszel-agent.service`):
   dedicated `otterd` user, `/opt/otterd/otterd`, checksum-verified
   download, hardened systemd unit (`ProtectSystem=strict`,
   `ProtectHome=read-only`, `ProtectClock`, `ProtectKernelLogs`,
   `LockPersonality`, `RemoveIPC`, `RestrictSUIDSGID`; loosened only for
   the docker socket once otterd runs containers), optional daily
   self-update timer, `otterd update` that detects systemd / OpenRC /
   rc.d. `cargo-dist` generates the release matrix, checksums and a
   shell installer; we wrap it with the enrollment token.

Do **not** port: PocketBase, the SSH server, the glibc/NVML build matrix
(phase 5 at the earliest), Windows.

## Phases

Each phase ships on its own and is useful without the next. There is no
"phase 0" patching the TypeScript agent: it is throwaway the day phase 1
lands, so nothing more goes into it.

### Phase 1: `apps/otterd` drop-in (2-3 weeks)

- Rust workspace at `apps/otterd`, single binary `otterd`, `x86_64` +
  `aarch64` `musl`, `FROM scratch` image `ghcr.io/otterdeploy/otterd`.
- Collectors to parity with today's `getHostHealth()`: cpu, load, memory
  (+swap/cache/ARC), filesystems, disk I/O, network, docker df, container
  stats (`bollard`), systemd units, uptime, otterd version. Patterns 1-6.
- Transport: **the existing `POST /api/agent/health`** with the existing
  token and body `{ hostname, health, capacity }`. The ingest already
  re-validates against `hostHealthSchema` and tolerates skew, so otterd
  is a drop-in for the swarm global service: `agent-service.ts` swaps
  `Image`/`Command` and drops the 256 MB cap to 32 MB.
- Web: chart the `server.metrics` host series (written on every ingest,
  currently no reader) with `shared/components/charts/time-series-chart.tsx`,
  so the phase is visible on the server page, not only in a table.
- Acceptance: RSS < 15 MB steady on a 20-container node, image < 10 MB,
  every `server_health_sample` section non-null that was non-null under
  the TS agent, `cargo clippy -D warnings`, no `unwrap` outside tests.

### Phase 2: identity + WebSocket + hub-driven cadence (2-3 weeks)

- Keypair, enrollment via `node_enrollment`, mutual nonce auth, WSS.
  `POST /api/agent/health` stays for one release as fallback, then goes.
- `HubRequest`/`AgentResponse` with the v1 actions and the reserved
  names. Control plane: per-node request manager with ids and 5 s
  timeouts (Beszel `request_manager.go`), a 60 s ticker per connected
  node, and a realtime ticker keyed by "server page open" (drive it from
  the existing `servers` channel on the org event bus).
- Node down = socket closed → `node.down` platform event with a pending
  timer (Beszel `alerts_status.go`), resolved on reconnect; a paused
  server row stays silent. Closes od-je0h.21. otterd version rides in
  `hello`; drift shows on the fleet card. Closes od-je0h.22. Closes
  od-5j8.20 (per-node identity, immediate revocation, encrypted).
- Realtime 1-5 s container stats replace the serial two-frame sampler.
  Closes od-3fxu.

### Phase 3: distribution and CLI (1-2 weeks)

- `cargo-dist` in `.github/workflows/otterd-release.yml` on the same
  `v*.*.*` tags; GitHub Release + checksums; `apps/get` serves
  `get.otterdeploy.com/otterd.sh` (and `/v0.x.y/otterd.sh`) from R2 next
  to `install.sh`.
- `otd server add <name>` mints the enrollment token and prints
  `curl -fsSL https://get.otterdeploy.com/otterd.sh | sh -s -- --token …`.
  Works on a plain Docker host, not only swarm.
- `otd top [server]` and `otd ps --server` read via oRPC from the control
  plane (never straight from otterd). `render.ts` gains one `meter`
  primitive; it is the only file allowed to decide a column.

### Phase 4: otterd runs localhost — the runtime cutover (4-6 weeks)

- `apply { instances[] }` reconciler in otterd against local Docker via
  `bollard`: pull with delivered registry creds, create on the
  per-project bridge network with aliases (exactly `dockerDriver`'s
  mapping), health gate, alias swap, stop-old. `status` streams
  container events back.
- A new `otterdDriver` implements `RuntimeDriver`; `dockerDriver` is
  removed once it is at parity on single node. Existing containers are
  **adopted** by their `otterdeploy.managed` / `otterdeploy.resource.id`
  labels: no redeploy on upgrade.
- `service_instance` table: `(resource, server, replica) → container`,
  the placement column defaults to the primary server.
- This is the phase that proves "only driver" with zero networking risk.

### Phase 5: close the side doors (ongoing, ~a quarter)

Walk the 54-file `Docker.fromEnv()` inventory: logs, exec/terminal,
volumes, backups, database branching/snapshots, reclaim, orphan GC,
image-pull progress, events. Each becomes an otterd verb or is
documented as primary-host-only. Remote servers stop being read-only as
each one lands.

### Phase 6: multi-server (4-6 weeks, after od-xer mesh)

Explicit placement in the service settings (a server picker), per-server
replicas, control-plane DNS over mesh IPs for cross-node names, the
swarm → otterd migration command, then `swarmDriver` is deleted.

### Phase 7: rollups, alert rules, second-wave sensors

Rollup ladder as a BullMQ cron (od-je0h.11 / .6); persisted alert rules
with Beszel's "average over `min` minutes + 90 s slack" semantic and a
resolution event (od-je0h.17 / .18 / .19 / .20); temperatures, fans,
GPU (nvidia-smi subprocess first, NVML never), SMART on request
(od-je0h.12).

## Non-goals

- Inbound hub→otterd SSH, Windows, macOS daemons.
- A scheduler. See "what we are not building".
- Daemon-side history, daemon-side alert evaluation, a daemon-side HTTP
  API for the CLI (the CLI talks to the control plane; otterd has one
  socket, outbound).
