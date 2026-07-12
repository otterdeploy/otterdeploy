# Server onboarding — SSH bootstrap into the shared swarm

Status: **design** (MVP implementing). Supersedes the manual copy-paste
`docker swarm join` flow in `server-create-dialog.tsx`.

## Problem

Adding a second host today is manual: the operator SSHes into the box
themselves, installs Docker by hand, copies a join token out of the "Add
server" dialog, and pastes `docker swarm join …` on the remote. The dialog's
own copy — *"Otterdeploy will retry SSH every 10s until the daemon answers"* —
describes code that does not exist. Coolify, Dokploy, and Kamal all instead
**dial out over SSH and provision the host automatically**; we should too.

Everything *after* the join is already built: the `server` registry, the node
lifecycle router (`list`/`promote`/`demote`/`drain`/`remove` + quorum guards),
hostname→node matching (`node-match.ts`), and the push health agent that
auto-covers any node that joins. **The only missing piece is provisioning: get
Docker onto a fresh host and run the join.** This design fills exactly that gap.

## The model: SSH is the *bootstrap* transport, not the *control* transport

We connect over SSH **only** to install Docker and join the node to the one
shared swarm. After that, the node is managed the way every other node already
is — through the manager socket + swarm scheduler — and observed through the
push health agent. We do **not** adopt Dokploy's per-server "dockerode over
SSH" model: that makes each host an island with its own overlay, throwing away
the cross-host overlay networking that is otterdeploy's actual advantage over
Coolify/Dokploy (see the "coolify multi-server networking gap" note).

One shared swarm, one overlay spanning every node, one control plane talking to
the manager daemon. SSH is a means to an end (a joined node), then it steps out
of the runtime path.

### Why not per-server SSH runtime

| | Per-server SSH (Dokploy) | Shared swarm (ours) |
|---|---|---|
| Docker access | one daemon per host, over SSH | one manager socket |
| Cross-host networking | islands (overlay per host) | **one overlay spans all nodes** |
| Scheduling | control plane picks the host | swarm scheduler |
| New runtime code | per-node dockerode clients, everywhere | **none** — reuse the manager socket |

## Three architecture questions this answers

These three are one interlocked story: **high availability = replicated
services + a redundant edge + manager quorum, all turned on together.** The MVP
ships none of them and is honest about the single point of failure; the HA tier
turns them on.

### 1. If the primary (manager) host dies, do the others keep serving?

Separate the two planes:

- **Data plane survives.** Tasks already running on worker nodes keep running,
  the overlay keeps routing, internal service discovery keeps working — even
  with the manager down. What is lost is the **control** plane: no
  rescheduling, no scaling, no deploys (no Raft leader).
- **"Keep serving traffic" is not automatic.** It needs three things a
  single-manager MVP lacks:
  1. **Replicas on a survivor** — a `replicas ≥ 2` (or Global) swarm service
     survives one node dying; a single task pinned to the dead node stays down
     until a manager reschedules it.
  2. **An edge on a survivor** — if Caddy runs only on the primary, live worker
     tasks are unreachable from outside (see §3).
  3. **The public IP resolving to a survivor** (multi-A DNS / floating VIP /
     external LB) **and 3+ managers** for Raft quorum so rescheduling can run.

**MVP** ships single-manager: apps survive a primary *reboot*, but the primary
is a genuine SPOF for the edge and for management. This is the same posture
Coolify/Dokploy ship. **HA tier** (later): 3 managers + swarm-mode replicas +
Global Caddy + IP failover.

**Statefuls (databases) are excepted at every tier** — pinned to a node with a
local volume; their HA is a replication problem swarm doesn't solve. Backups/DR
cover it.

### 2. Two deploy modes (non-swarm and swarm)

Runtime mode stays a **global** `DEPLOY_RUNTIME` switch (confirmed decision —
not per-service). The two "modes" are therefore **install-level**:

- **Plain-docker install** (`DEPLOY_RUNTIME` unset/`docker`) — single host,
  containers on the local bridge. This is the default fresh install. Adding a
  server is not available in this mode.
- **Swarm install** (`DEPLOY_RUNTIME=swarm`) — a cluster. The scheduler
  distributes services; the overlay spans nodes; adding servers is available.

**Adding the first remote server is the transition point.** If the primary is
not yet a swarm, onboarding runs `docker swarm init` on it (promoting it to
manager) before the new host joins as a worker. Existing plain-docker workloads
keep running untouched on the primary — the flip to a swarm manager is additive
(a host runs standalone containers and swarm tasks side by side). New
deployments then go through the swarm driver.

Remote worker nodes only ever run **swarm** workloads — we never SSH a worker's
daemon to `docker run`. Want something on a *specific* node? That's a swarm
service with a placement constraint (`node.hostname==…`), not a plain container.

### 3. Does the new server get its own Caddy?

- **MVP: no.** One Caddy on the primary. New servers run app containers only.
  Caddy attaches to each project overlay and proxies to the service's swarm
  VIP; swarm's internal LB fans out to tasks on **any** node, including the new
  one. So a new server serves traffic through the primary's Caddy without
  running its own. This is the §1 SPOF.
- **HA tier: yes.** Caddy becomes a **Global swarm service** (one task per node
  → every new server automatically gets one). Two things make that safe:
  1. **Shared cert storage** so the N Caddys coordinate ACME and share certs
     instead of each racing Let's Encrypt — Caddy's storage-module pointed at
     Redis/Postgres (both already run).
  2. **Config distribution** — the reconciled Caddyfile shipped as a swarm
     config (or pulled from the control plane) and rolled on every reconcile,
     instead of one local file.
  `forward_auth` / edge-logs / CrowdSec keep pointing at the control plane and
  just need overlay/tailnet reachability. Plus the §1 IP-failover piece.

## SSH authentication

Reuse the existing `ssh_key` table (org-scoped, private half AES-GCM encrypted
via `lib/crypto.ts`) and the `sshKeys` router's `keygen.ts`. Two ways in:

1. **Managed key** — generate a keypair in-app (or select an existing one);
   the operator installs the **public** key on the host once
   (`echo "<pub>" >> ~/.ssh/authorized_keys`). We connect with the private
   half. This is Dokploy's model.
2. **One-time password bootstrap** (UX win over both competitors) — the
   operator gives us a host + user + **password for the first connection
   only**. We connect once with the password, install our managed public key,
   then immediately switch to key auth for everything after. The password is
   held in memory for the single bootstrap connection and **never stored**.

Non-root users need passwordless sudo; the provisioner detects root vs sudo and
prints the exact `sudoers.d` line if it's missing (Dokploy idiom).

## Provisioning flow

Net-new: an SSH-exec helper (lazy-load `ssh2`'s `Client`, exec channel with
streamed stdout/stderr, reject on non-zero — mirrors how `storage.ts` lazy-loads
`ssh2-sftp-client`) and a provision/join orchestrator. Steps, each streamed live
into the existing deployment-log/activity UI pattern:

1. **Connect & probe** — `ls /` reachability; `cat /etc/os-release` for the OS
   family (apt/dnf/pacman/apk/zypper); root-vs-sudo detection.
2. **Install prerequisites** — `curl wget git jq openssl` via the detected
   package manager.
3. **Install Docker** — `curl -fsSL https://get.docker.com | sh` with
   distro-specific fallbacks; reject snap Docker; `systemctl enable --now
   docker`; json-file log rotation in `/etc/docker/daemon.json` (merged with
   `jq`). (Scripts adaptable from the `research/coolify` and `research/dokploy`
   clones — `InstallDocker.php`, `server-setup.ts`.)
4. **Ensure swarm** — if the primary isn't a swarm yet, `docker swarm init
   --advertise-addr <primary>` on it first. Fetch the current token from
   `getSwarmJoinTokens()` (already built) and run `docker swarm join --token
   <worker|manager> <managerAddr>:2377` on the new host.
5. **Verify** — poll `docker node ls` from the manager until the new node
   appears `ready`; match it to the server row by hostname (`node-match.ts`).
6. **Register** — insert/settle the `server` row server-side **after** a
   verified join (replacing today's optimistic insert). Capacity/`daemonVersion`
   backfill via the health agent, which reschedules onto the node automatically.

Idempotent throughout: re-running against a half-provisioned host detects each
step's completion and skips it.

### Networking: public now, Tailscale fast-follow

MVP joins over the public IP (`:2377` exposed on the manager) — matches
Coolify/Dokploy. The provisioner is structured so a **Tailscale mode** drops in
(per `docs/designs/tailscale.md`): an extra step installs `tailscaled` +
`tailscale up --authkey`, and the advertise/join address becomes the `100.x`
tailnet address so `:2377` never faces the internet.

## Data model

`server` and `ssh_key` already cover the registry and credentials. New:

- **`server.provisionStatus`** enum (`pending` | `provisioning` | `joining` |
  `ready` | `failed`) + **`server.provisionError`** text — drives the live
  onboarding UI and lets a failed run be retried. (`ready` overlaps the swarm
  `status`; this column tracks the *provisioning* lifecycle specifically.)
- **`server.sshKeyId`** FK → `ssh_key` — which managed key reaches this host.
- **`server.sshUser`** / **`server.sshPort`** — connection details (default
  `root` / `22`).

A **provisioning-log stream** reuses the deployment-log transport (event
iterators, per the streaming-transport convention) rather than a new table —
onboarding output is ephemeral.

## API surface (`server` router)

Additive to the existing contract:

- `server.provision` — `{ name, host, sshUser?, sshPort?, sshKeyId? | password?,
  role }` → inserts the row in `pending`, kicks off the background runner, and
  returns the row immediately in `provisioning` state. The handler rejects
  neither/both credentials (`BAD_REQUEST`).
- `server.provisionLogs` — event-iterator stream of the live provisioning
  output (shared `useLogStream` on the client). Org-owns-server auth boundary.
- `server.retryProvision` — re-run against a `failed` row. Refused for
  password-provisioned rows (the one-time password was never stored).
- (existing `create` stays for the manual path / bootstrap localhost.)

MVP runs the provision **in-process, fire-and-forget** (`provision-runner.ts`):
it mints the join token from the local manager socket, SSHes out
(`ssh-exec.ts`, lazy `ssh2`), runs the steps (`provision.ts`), verifies the node
in `docker node ls`, and advances `provisionStatus`. Lines fan out over Redis
pub/sub + an in-process ring (`provision-stream.ts`, same mechanism as the
deploy log tail). Moving the runner to a BullMQ job is a hardening follow-on
(survives an API restart mid-provision); the seam is already isolated.

**No auto swarm-init.** The existing local `ensureSwarm()` advertises a loopback
address (fine single-node, unreachable for a remote join), so the runner does
NOT create a swarm. It requires an already-routable swarm and fails with an
actionable message when the manager address is missing or loopback — the
advertise-address gap below.

## UI flow

Replace `server-create-dialog.tsx`'s manual join panel with a provisioning
flow that mirrors the "Validate & Install" stepper pattern:

1. **Add server** — name, host/IP, SSH user (default `root`), port (default
   22), and auth: pick a managed key **or** enter a one-time password.
2. **Provision** — a live log drawer streams Connect → OS → Prereqs → Docker →
   Join → Verify (via `server.provisionLogs`). No commands to paste on the host.
3. **Ready** — the row flips to `ready`, appears in the swarm-nodes card and
   servers table, and the health agent starts reporting. Manager promotion,
   drain, and removal are the already-built node-lifecycle actions.

## Connectivity: mesh, tunnels, and build servers

Confirmed additions layered onto the flow above. Research (`research/`) found
**neither Coolify nor Dokploy runs a node mesh** — this is greenfield; Coolify's
only NAT story is Cloudflare Tunnel over SSH.

### Mesh (Tailscale / NetBird) — the routable-address fix

`server.meshProvider` (`none | tailscale | netbird`). When set, provisioning
installs the WireGuard agent **before** the swarm join, brings it up with the
operator's one-time key, reads the node's mesh IP (`tailscale ip -4` /
`wt0` interface), and joins with `--advertise-addr <mesh-ip>` so inter-node
overlay traffic rides the mesh. This is the clean answer to the loopback
advertise-address gap: the manager advertises its mesh IP, workers reach it over
the tailnet, and `:2377` never faces the internet. The mesh IP is persisted to
`server.meshAddress`. Auth keys are **one-time, never stored** (encrypted only in
transit through the job payload), so — like the password — a **mesh provision
can't be retried** (re-add the server). NetBird supports a self-hosted
`--management-url`. `meshInstallScript`/`parseMeshAddress` are pure + unit-tested.
(Full org-level tailnet OAuth + service exposure remains the `tailscale.md`
design; this is the node-join slice.)

### Cloudflare Tunnel — NAT/ingress connector

`cloudflareToken` (one-time) installs a `cloudflare/cloudflared` host-network
container running the connector (the Coolify pattern). This covers reaching a
NAT'd node / ingress. **Note the role distinction:** CF Tunnel is *not* a node
mesh — it doesn't provide swarm interconnect. Reaching a NAT'd host's SSH for the
*initial* connection via `cloudflared access ssh` needs a ProxyCommand, which our
`ssh2`-library transport doesn't wire yet (Coolify uses CLI ssh) — that, plus
service-exposure-via-CF (a Caddy-layer concern), are follow-ons.

### Build servers

`server.buildServer` (bool). A build node joins the swarm normally, then the
manager labels it `otterdeploy.role=build` (via `docker node update`) so build
workloads can be placed there, off the deploy nodes. Per the research, image
hand-off is **registry-based** (build here → deploy nodes pull) — so the
consuming half (route builds to `node.labels.otterdeploy.role==build`, enforce a
registry, à la Dokploy's `buildServerId || serverId`) is a **builder follow-on**;
this slice ships the designation + label + capacity to schedule against it.

### BullMQ hardening (done)

The runner is now the `server.provision` BullMQ job (`packages/jobs`), enqueued by
the API handler and executed by the worker in `apps/server` (which has the
manager socket + SSH) via `createWorkers`' same-name handler override — the exact
mechanism the builder uses for `deploy.triggered`. Survives an API restart
mid-flow; `attempts: 1` (the operator retries explicitly). **Secrets (SSH
password, mesh key, CF token) travel as AES-GCM ciphertext** so Redis never holds
plaintext; the worker decrypts.

## Phasing

- **Phase 1 (MVP, this pass)** — SSH-exec helper; provision+join job; the three
  new `server` columns; `provision`/`provisionLogs`/`retryProvision` API;
  provisioning UI. Single manager, one Caddy, public join. Honest SPOF.
- **Phase 2 (Tailscale)** — `tailscaled` install step + tailnet advertise
  address; `server.create` "Join over Tailscale" path (per `tailscale.md`).
- **Phase 3 (HA)** — 3-manager quorum guidance/automation; Global Caddy with
  shared cert storage + swarm-config distribution; IP-failover guidance
  (multi-A / floating VIP / external LB); swarm-mode replica defaults.

## Open items

- **Password-bootstrap security** — password strictly in-memory for one
  connection, never logged, never persisted. Audit the log stream for leakage.
- **`ssh2` native build** — it's a transitive/optional dep today (SFTP
  backups). The provisioner must lazy-load it and fail with the same actionable
  "run bun install" message when absent, so it can't break install for
  plain-docker operators who never add a server.
- **Manager-address detection** behind NAT — `getSwarmJoinTokens()` reports the
  daemon's `NodeAddr`; operators behind NAT may need an explicit advertise
  address. Surface an override field. (Tailscale mode sidesteps this.)
- **db:push** required for the new `server` columns.
