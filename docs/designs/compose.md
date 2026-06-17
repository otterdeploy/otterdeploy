# Docker Compose stacks

Status: **in progress** (Phase 1). Owner: platform.

Deploy a user-supplied `compose.yml` as a first-class resource — a **stack** of
N services managed as one unit. Chosen over "explode into N independent service
resources" because a compose file is an atomic mini-application (shared network,
`depends_on`, volumes) and users expect one deploy/stop/remove action.

## Why this is tractable (reuse, not rebuild)

The platform is **already** a stack engine:

- **Internal model** — `packages/api/src/stack/schema.ts` (`StackFile`/`StackService`)
  is a compose-compatible Zod model (image, command, env, ports, volumes,
  healthcheck, deploy, depends_on). We parse *into* this, not a new shape.
- **YAML** — `Bun.YAML.parse`/`stringify` is already used (`render/to-compose.ts`).
  No new dependency; parsing happens **server-side** (web just ships raw text).
- **Deploy primitive** — `swarm/service.ts#provisionSwarmService` + `ensureProjectNetwork`
  already deploy ONE service (env/ports/mounts/healthcheck) on a per-project
  overlay network with DNS-by-service-name. A compose stack = call this **per
  compose service**, all on the same project overlay net, tagged with one stack
  namespace label so we can list/remove them as a unit.
- **Builder** — `apps/builder` already builds git/Dockerfile/railpack → image →
  registry. A compose service with `build:` reuses that per service.

So "native stack deploy" is **not** `docker stack deploy -c` (CLI, manager-only,
fragile). It is: parse compose → for each service produce a `SwarmServiceSpec` →
`provisionSwarmService`, labelled `otterdeploy.stack=<resourceId>`. Lifecycle =
list/remove services by that label.

## Data model

New resource `type: 'compose'` (alongside `service`/`database`). One compose
resource = one stack = one `deployment` per deploy (reuses the deployment table).
Sub-services are **not** separate `resource` rows — they're swarm services owned
by the compose resource, surfaced in the graph as a group node that expands.

New `compose_resource` table (parallel to `service_resource`):

| col | type | note |
|---|---|---|
| resourceId | PK/FK → resource | |
| source | enum `inline`\|`git` | pasted file, or a compose path in a repo |
| composeContent | text, nullable | inline source: the raw YAML |
| composePath | text, nullable | git source: path to compose file (default `./compose.yml`) |
| gitRepoUrl/gitRef/sourceSubdir | text | git source |
| stackName | text unique | swarm namespace (`<projectSlug>-<resourceSlug>`) |
| services | jsonb | **derived** parse summary for UI (name, image, hasBuild, ports) — refreshed on save/deploy, never authoritative |
| exposed | jsonb | which `service:port` get a public domain |
| forceUpdateCounter | int | force swarm task diff |

`${VAR}` interpolation: compose `${FOO}` refs resolve against the project/env
variable cascade at deploy time (reuse `resolveServiceEnv`), and unknown refs are
surfaced as "promote to project variable" in the UI (Phase 5).

## Phases

1. **Foundation (this PR)** — `resource_type` enum `compose`; `compose_resource`
   table + relations; id prefix; manifest `compose` source variant. Needs `db:push`.
2. **Parse + normalize** — `stack/compose/parse.ts`: `Bun.YAML.parse` → validate →
   normalize each service into `StackService`-ish + classify `image:` vs `build:`.
   Pure, unit-tested. Reused by builder + deploy + UI preview.
3. **Builder** — `composeBuild()` in `apps/builder`: for each `build:` service run
   the existing dockerfile/railpack path → push → rewrite to the built image tag;
   `image:` services pass through. Replaces the railpack-fallback stub in
   `pipeline.ts:176`. Output = resolved compose (all `image:`).
4. **Deploy + lifecycle** — `swarm/compose.ts`: resolved compose → per-service
   `SwarmServiceSpec` → `provisionSwarmService` on the project overlay net, labelled
   `otterdeploy.stack=<resourceId>`. Redeploy = reconcile the label set (create new,
   update changed, remove gone). Stop/remove = remove all by label. Runtime status =
   aggregate of the N services' tasks.
5. **Frontend** — wizard compose step (paste/upload → server-parse preview of
   detected services) ; `${VAR}` promotion; expose-which-service mapping; graph
   group node; remove `comingSoon`.
6. **Networking/domains** — exposed `service:port` → Caddy route (reuse the
   proxy_route path), one host per exposed service.

## Deferred / non-goals (v1)

- Compose `secrets`/`configs` top-level (swarm secrets) — Phase 6+.
- `extends`, multiple compose files / overrides, `profiles` — later.
- `depends_on` strict ordering beyond best-effort (swarm has no native wait).
- Bind mounts to host paths (security) — volumes only.
