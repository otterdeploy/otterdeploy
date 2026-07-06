# Server health agent — per-node health for multi-server installs

## Why

`system.hostHealth` reads only the machine the control plane runs on (`/proc`
meminfo, `statfs` at the data root, `docker system df` on the local socket).
The Servers page shows swarm **allocations** (task reservations vs capacity),
never live utilization — the `server` schema note says it outright: *"runtime
stats come from a separate metrics path (TBD)."* On a multi-node swarm, the
operator is blind to a worker filling its disk until deploys start failing.

This is that separate metrics path: a tiny **health agent** on every node that
reports the same `HostHealth` snapshot the local path already produces, so the
Servers page shows honest per-server memory/disk/docker usage.

Competitor anchor: Coolify's Sentinel (a per-server metrics agent pushing to
the control plane) — same shape, minus the separate binary: our agent is the
unified server image running a different command.

## Design

### Collection model: push, via a swarm global service

- **Agent = the unified `server` image with an agent entrypoint** (`bun run
  src/health-agent.ts` in `apps/server`, the same run-from-source trick the
  builder role uses). No new image to build or distribute; the agent reuses
  `getHostHealth()` verbatim — recon confirmed it is **DB-free** (only `/proc`,
  `statfs`, the local docker socket, and raw `process.env`).
- **Deployment = one swarm service in `Global` mode** (`otterdeploy-health-agent`),
  so swarm schedules exactly one task per node, including nodes that join
  later. Mounts: `/var/run/docker.sock` (docker df). Env:
  `OTTERDEPLOY_NODE_HOSTNAME={{.Node.Hostname}}` (swarm env templating),
  `HEALTH_AGENT_TOKEN`, `HEALTH_AGENT_INGEST_URL`, `HEALTH_AGENT_INTERVAL_MS`.
- **Push, not pull.** The control plane cannot reach remote docker daemons
  today (single `Docker.fromEnv()` socket). `tailscale.md` phase 2 proposes
  per-node Docker clients over the mesh — when that lands, health could become
  pull; until then push works over any network where the node can reach the
  control-plane URL (which it must anyway for the dashboard to be useful).
- **Runtime gating:** the agent reconciler runs only under
  `DEPLOY_RUNTIME=swarm`. The plain-docker default is single-host — there, the
  local sampler (below) covers "every server".

### Local host: same table, no agent

A 60s background sampler on the control plane runs `getHostHealth()` and
upserts into the same store for the bootstrap `localhost` server row(s) — so
the read path is **uniform**: one table, latest snapshot per server, staleness
derived from `sampledAt`. (The existing 5m `host-health-monitor` keeps its
job — alerts + `platform_metric` history; the 60s sampler is UI freshness.)

### Storage: `server_health_sample`

One row per server, **latest snapshot only** (upsert on `serverId`):

- `serverId` PK/FK (cascade), `organizationId` FK
- `payload` jsonb — the `HostHealth` shape as reported
- `hostname` — as claimed by the reporter (attribution audit trail)
- `sampledAt` (reporter clock), `receivedAt` (our clock — staleness uses this;
  agent clocks may skew)

History stays out of scope: `platform_metric` already records local-host
series; per-node history can graduate there later. Latest-only keeps db:push
trivial and the table O(nodes).

### Attribution: hostname match, capacity self-registration

The ingest handler maps the claimed hostname → server rows using the existing
convention (`stats.ts`: match against `server.hostname` OR `server.name`),
across **all orgs** (bootstrap creates one row per org for the same machine —
a sample upserts into every matching row). Unknown hostname → drop + log
(server registration stays an explicit UI act; no ghost rows).

Bonus the contract already anticipated (*"populated when the agent
self-registers"*): a report carries `cpuTotal`/`memTotalGb`/`daemonVersion`,
and the handler backfills them onto matched rows that still have zeros.

### Auth: HMAC token over `BETTER_AUTH_SECRET`

The established machine-credential idiom (`authz/tokens.ts`: purpose-tagged
base64url payload + HMAC-SHA256, timing-safe verify — no new secret to
provision). The reconciler mints a `health-agent` purpose token when it
(re)creates the agent service and injects it as env. Ingest verifies the HMAC;
the route joins the `identify` exclude list (webhook pattern — auth is
per-source, not session).

Trust model v1: any node holding the token can claim any hostname. Acceptable
— agent nodes are swarm members, already trusted with workloads; the token
gates outsiders, not peers. Per-node tokens can come with stable node ids
(tailscale.md's `tailscaleNodeId`).

### Read path: `server.health`

New oRPC read next to `server.stats`: rows joined with their latest sample →
`{ serverId, health: HostHealth | null, sampledAt, stale }`, `stale` = older
than 3× the sample interval. UI polls it like the stats collection.

### Remote reclaim: phase 2, piggybacked commands

v1 is **read-only for remote nodes** — reclaim/grow buttons stay local-only
(honest: those actions execute on the local socket). Phase 2 options, in
preference order:

1. **Piggyback on the report cycle**: the ingest response carries pending
   commands (`reclaim: ["images", ...]`); the agent executes with its local
   `reclaimSpace()` and reports the outcome next cycle. No new channel, ~60s
   latency — fine for prune ops.
2. One-shot `ReplicatedJob` services with `Placement.Constraints
   [node.hostname == X]` — no agent involvement, but a heavier spec-builder
   extension.

### Swarm spec builder

`buildServiceSpec` hardcodes `Mode: { Replicated: ... }` and has no placement
support. The agent service spec is **hand-built** in the reconciler (it is not
an app service; forcing it through the app-spec builder would distort both).
`docker.services.create` takes the raw Docker API spec, so `Mode: { Global: {} }`
passes through.

## Pieces

1. `packages/db/src/schema/server.ts` — `server_health_sample` (db:push).
2. `packages/api/src/system-health/host-health.ts` — allow disk-path override
   via env (agent containers don't have the data dir; overlay-root statfs is
   an acceptable disk proxy, or operators bind-mount and point the env at it).
3. `apps/server/src/health-agent.ts` — sampler loop + POST, backoff on ingest
   failure, no DB import.
4. `packages/api/src/system-health/agent-token.ts` — mint/verify (authz/tokens
   idiom); ingest handler in `packages/api` + route wired in
   `apps/server/src/index.ts` (inline `// ─── ───` section convention).
5. Reconciler + local sampler registered in `apps/server/background-services.ts`.
6. `server.health` contract/handler; Servers page: live mem/disk per row
   (alongside the allocation bars — allocation ≠ utilization, show both),
   staleness badge, row detail with the full health body; the bottom "Host
   health" card remains the local host's action surface until phase 2.

## Non-goals (v1)

- Per-node metric **history** (platform_metric exists for local; extend later).
- Remote reclaim/grow (phase 2 above).
- Auto-registration of unknown nodes as server rows.
- CPU utilization sampling (needs a second-frame delta like metrics/sampler;
  memory+disk are the pressure signals that matter first).
