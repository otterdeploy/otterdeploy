# Runtime drivers — plain Docker by default, Swarm for scale

## Why

Docker Swarm (overlay networks, VIPs, manager quorum, rolling-update configs) is
heavy and finicky for the single-node case that covers the vast majority of
otterdeploy users (indie devs, small teams). Plain Docker + a per-project bridge
network is "more than enough" there. Swarm should be **opt-in**, for operators
who actually want to scale across nodes.

## The abstraction

Everything deploys through a `RuntimeDriver` (`packages/api/src/runtime/`). The
deploy layer builds a spec and calls `runtime().provision/update/destroy/inspect`
(and the `*Database` variants) — it never names Swarm.

- `ContainerSpec` / `DatabaseSpec` are the **same** shapes the swarm path already
  produced (`SwarmServiceSpec` / `ProvisionSwarmDatabaseInput`), re-aliased.
- `runtime()` picks the driver from `DEPLOY_RUNTIME` (env): `swarm` → opt-in,
  anything else (incl. unset) → **`docker` default**. Read straight off
  `process.env` so importing the runtime never drags full env validation into
  the deploy import graph.

### `docker` driver (default, single-node)

- service → one `docker create` + `start`; `update` recreates (brief blip; no
  in-place rolling update — blue-green is a later add).
- replicas → always 1. Real fan-out + LB needs Swarm; the UI gates replicas>1.
- network → a per-project **user-defined bridge** (`otterdeploy-<slug>`); peers
  resolve each other by container **name/alias** (what Compose gives you).
- database → a single-replica stateful container (volume + healthcheck + opt
  host port); recreate-on-update is naturally stop-first (no dual-mount).
- status → `docker ps` State + Health (no swarm tasks).

### `swarm` driver (opt-in, multi-node)

Pure delegation to the existing `swarm/*` functions. Unchanged behavior.

## Wiring

- Services / compose-member services: `service/redeploy.ts` (`provisionFresh` →
  `runtime().provision`, `redeployOne` → `runtime().update`), service delete +
  compose reconcile teardown → `runtime().destroy`, runtime view →
  `runtime().inspect`.
- Databases: all call sites import the same-named functions from
  `runtime/db.ts` (a drop-in shim) instead of `swarm` — only the import path
  moved, call expressions unchanged.

## Remaining (phased)

- **Edge**: in docker mode Caddy must join each project's bridge network to
  reach containers by name (it already attaches per-project on swarm). Upstream
  host stays the service name/alias.
- **UX**: surface "Scaling" (Swarm) as an explicit mode; gate replicas>1 behind
  it instead of silently running 1.
- **Migration**: an existing swarm-deployed stack/service needs a redeploy to
  land as plain containers.
