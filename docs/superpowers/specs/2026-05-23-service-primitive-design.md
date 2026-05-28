# Service Primitive — Design Spec

**Date:** 2026-05-23
**Owner:** Jefferson
**Status:** Approved (brainstorming → implementation)

## 1. Goal

Add a first-class **Service** resource to otterdeploy so a user can deploy a
container from a Docker image into a project, with full Railway-parity
configuration. The first slice ships:

- Full Railway-parity inputs on create (image, ports, env, replicas,
  healthcheck, restart policy, resource limits)
- Internal-only networking by default; opt-in public exposure via auto
  subdomain (custom domains deferred)
- Lifecycle: `create`, `get`, `list`, `update` (implicit redeploy),
  `delete`, `restart`. Stop/start are `update({ replicas: 0 | N })`.
- Env vars in a dedicated `service_env_var` table, with Railway-style
  references `${{<ResourceName>.<VAR>}}`
- Auto-redeploy of dependents when a referenced value changes

Out of scope (follow-ups):

- Persistent volumes
- Git-based builds (Nixpacks/Dockerfile)
- Custom domains + cert provisioning
- Deployments history / rollback
- Project-scoped shared env vars
- Multi-region / multi-host scheduling beyond Swarm defaults

## 2. Architecture

The Service primitive extends the existing `resource` taxonomy
(`resource.type ∈ {'database','service'}` — `'service'` is already in the
enum, unused). Same shape as the Postgres flow: a generic `resource` row, a
typed sidecar, child tables, and a Swarm provisioner that materializes the
resource on the host.

Packages touched:

- `packages/db/src/schema/project.ts` — add `service_resource`,
  `service_port`, `service_env_var` tables.
- `packages/shared/src/id.ts` — add `servicePort`, `serviceEnvVar`
  prefixes.
- `packages/api/src/constants.ts` — add `PLATFORM.service` with
  `publicBaseDomain`.
- `packages/api/src/lib/queries/service.ts` — **new**, all Drizzle calls
  for the service primitive (per project rule: queries live in
  `packages/api`, not `packages/db`).
- `packages/api/src/lib/variables/` — **new** module: exporter registry,
  parser, resolver, dependency graph, cycle detection.
- `packages/api/src/swarm/service.ts` — **new** provisioner mirroring
  `swarm/postgres.ts`.
- `packages/api/src/routers/service/` — **new** router:
  `contract.ts`, `index.ts`, `handlers.ts` (named `handlers` to avoid
  collision with the resource-type name).
- `packages/api/src/routers/index.ts` — register `service` in
  `appRouter`.
- `packages/api/src/routers/project/service.ts` — add a Postgres-side
  `getExportedVariables` adapter consumed by the resolver.

Existing Caddy reconciler is reused unchanged: `expose()` writes a
`proxy_route` row and triggers reconcile.

## 3. Data Model

### `service_resource` (1:1 sidecar to `resource`)

| Column                | Type                            | Notes                                     |
| --------------------- | ------------------------------- | ----------------------------------------- |
| `resourceId`          | text PK FK→resource(id) cascade |                                           |
| `image`               | text not null                   | e.g. `nginx:1.27`                         |
| `imageDigest`         | text nullable                   | Pinned after first successful deploy      |
| `command`             | text[] nullable                 | CMD override                              |
| `entrypoint`          | text[] nullable                 |                                           |
| `replicas`            | int not null default 1          |                                           |
| `restartCondition`    | enum('none','on-failure','any') | default `'on-failure'`                    |
| `restartMaxAttempts`  | int nullable                    |                                           |
| `restartDelayMs`      | int default 5000                |                                           |
| `healthcheckCmd`      | text[] nullable                 | If null, inherit image healthcheck        |
| `healthcheckIntervalMs` | int nullable                  |                                           |
| `healthcheckTimeoutMs`  | int nullable                  |                                           |
| `healthcheckRetries`    | int nullable                  |                                           |
| `healthcheckStartMs`    | int nullable                  | start_period                              |
| `cpuLimit`            | numeric(4,2) nullable           | Fractional cores                          |
| `memoryLimitMb`       | int nullable                    |                                           |
| `cpuReservation`      | numeric(4,2) nullable           |                                           |
| `memoryReservationMb` | int nullable                    |                                           |
| `internalHostname`    | text not null                   | Alias on project Swarm network            |
| `serviceName`         | text not null                   | Docker service name (`otterdeploy-svc-…`)  |
| `networkName`         | text not null                   |                                           |
| `publicEnabled`       | bool not null default false     |                                           |
| `publicDomain`        | text nullable                   | Set when `publicEnabled` flips true       |
| `forceUpdateCounter`  | int not null default 0          | Incremented for restart-only operations   |
| `createdAt/updatedAt` | timestamp                       |                                           |

Unique indexes: `service_resource_service_name_unique`,
`service_resource_internal_hostname_unique`,
`service_resource_public_domain_unique` (partial, where not null).

Runtime status is read live from Docker by `inspectSwarmServiceRuntime`
— not persisted. Mirrors the Postgres pattern.

### `service_port` (1:N child)

| Column              | Type                          | Notes                              |
| ------------------- | ----------------------------- | ---------------------------------- |
| `id`                | text PK `port_…`              |                                    |
| `serviceResourceId` | text FK→service_resource cascade |                                |
| `containerPort`     | int not null                  | Port inside the container          |
| `protocol`          | enum('tcp','udp') default 'tcp' | Transport                        |
| `appProtocol`       | enum('http','tcp') default 'http' | Informs Caddy http vs layer4   |
| `isPrimary`         | bool default false            | Public exposure targets the primary HTTP port |

Constraints:

- `unique (serviceResourceId, containerPort, protocol)`
- DB CHECK: at most one row per service has `isPrimary=true`
- Application-level invariant: exactly one HTTP port must be primary if
  `publicEnabled=true`

### `service_env_var` (1:N child)

| Column              | Type                                | Notes                                  |
| ------------------- | ----------------------------------- | -------------------------------------- |
| `id`                | text PK `senv_…`                    |                                        |
| `serviceResourceId` | text FK→service_resource cascade    |                                        |
| `key`               | text not null                       | Must match `^[A-Z_][A-Z0-9_]*$`        |
| `value`             | text not null                       | Raw; may contain `${{Resource.VAR}}`   |
| `createdAt/updatedAt` | timestamp                         |                                        |

Constraint: `unique (serviceResourceId, key)`

### Existing tables

- `resource` — reused unchanged. `service` rows start `status='draft'`,
  flip to `'valid'` after first successful Swarm create.
- `proxy_route` — unchanged. `expose()` inserts a row of `type='http'`.
- Postgres `database_resource` — no schema change. Its exporter
  computes variables from existing columns.

### Migration

Single Drizzle migration: `add_service_resource.sql`. No data
backfill needed — `service` resources don't exist yet.

## 4. Variable References & Resolver

### Grammar

```
${{<ResourceName>.<VarName>}}
```

- `ResourceName` matches a `resource.name` within the same project
  (case-sensitive).
- `VarName` matches a key exported by that resource's exporter.
- Multiple refs per value allowed: `"postgres://${{db.PGUSER}}:${{db.PGPASSWORD}}@${{db.PGHOST}}"`.
- Literal `${{` is escaped with a backslash: `\${{not-a-ref}}`. The
  resolver replaces `\${{` → `${{` after substitution.

### Exporter Registry

`packages/api/src/lib/variables/exporters.ts`:

```ts
type Exporter = (resourceId: string) => Promise<Record<string, string>>;

const exporters: Record<ResourceType, Exporter> = {
  database: postgresExporter,
  service: serviceExporter,
};
```

**Postgres exporter** (`database` type, `engine='postgres'`) — computed
from `database_resource` columns:

| Var                | Source                                    |
| ------------------ | ----------------------------------------- |
| `DATABASE_URL`     | `internalConnectionString`                |
| `PGHOST`           | `internalHostname`                        |
| `PGPORT`           | `internalPort`                            |
| `PGUSER`           | `username`                                |
| `PGPASSWORD`       | `password`                                |
| `PGDATABASE`       | `databaseName`                            |

**Service exporter** — for service-to-service references:

| Var                 | Source                                            |
| ------------------- | ------------------------------------------------- |
| `<KEY>`             | The literal env var value (after recursive resolve) |
| `HOST` / `<NAME>_HOST` | `internalHostname`                             |
| `PORT` / `<NAME>_PORT` | Primary port (or first http port)              |
| `URL`  / `<NAME>_URL`  | `http://<internalHostname>:<port>` if http     |

### Resolver

`packages/api/src/lib/variables/resolver.ts`:

```ts
resolveEnv(
  projectId: string,
  serviceResourceId: string,
): Promise<Result<Record<string, string>, ResolveError>>
```

Algorithm:

1. Load all env vars for the service.
2. For each value, parse tokens. For each token, look up
   `<ResourceName>` in the project (`resource` table joined on
   project_id, filtered by name). If missing → `MissingResource`.
3. Call the exporter for that resource type. Cache exporter results per
   call (don't re-query the same resource twice).
4. If the referenced resource is itself a service, recurse with a
   visited-set to detect cycles → `CycleDetected`.
5. Substitute and return resolved map. Unescape `\${{` → `${{`.

### Dependency Graph

`packages/api/src/lib/variables/graph.ts`:

```ts
findDependents(
  projectId: string,
  resourceId: string,
): Promise<string[]>  // serviceResourceIds that reference this resource
```

Implementation: SQL scan of `service_env_var.value LIKE '%${{<name>.%'`
within the project. No materialized graph in v1 — re-scan on each
upstream change. Optimization candidate if it gets hot.

### Auto-Redeploy Fan-Out

Triggered from any mutation that changes an exporter's output:

- Postgres password rotation (currently not exposed — future-proofing)
- Postgres resource deletion → block with `IN_USE` if dependents exist
- Service env var update → redeploy this service AND its dependents
- Service rename → re-resolve dependents' refs
- Service deletion → block with `IN_USE` if dependents exist

Implementation in v1: **synchronous** within the mutating request. Walk
`findDependents`, call `updateSwarmService` for each with resolved env.
Mark as Inngest-job candidate if request latency becomes a problem.

## 5. API Contract

oRPC under `service.*`, REST mirror under `/projects/{projectId}/services`.
Auth: `protectedProcedure` (matches `project.*`).

### Schemas (zod)

```ts
serviceSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  name: z.string(),
  status: z.enum(["draft", "valid", "invalid"]),
  image: z.string(),
  imageDigest: z.string().nullable(),
  command: z.array(z.string()).nullable(),
  entrypoint: z.array(z.string()).nullable(),
  replicas: z.number().int().nonnegative(),
  restart: z.object({
    condition: z.enum(["none", "on-failure", "any"]),
    maxAttempts: z.number().int().nullable(),
    delayMs: z.number().int(),
  }),
  healthcheck: z.object({
    cmd: z.array(z.string()).nullable(),
    intervalMs: z.number().int().nullable(),
    timeoutMs: z.number().int().nullable(),
    retries: z.number().int().nullable(),
    startMs: z.number().int().nullable(),
  }),
  resources: z.object({
    cpuLimit: z.number().nullable(),
    memoryLimitMb: z.number().int().nullable(),
    cpuReservation: z.number().nullable(),
    memoryReservationMb: z.number().int().nullable(),
  }),
  ports: z.array(z.object({
    id: z.string(),
    containerPort: z.number().int(),
    protocol: z.enum(["tcp", "udp"]),
    appProtocol: z.enum(["http", "tcp"]),
    isPrimary: z.boolean(),
  })),
  publicEnabled: z.boolean(),
  publicDomain: z.string().nullable(),
  internalHostname: z.string(),
  runtime: z.object({
    serviceId: z.string().nullable(),
    serviceName: z.string(),
    networkName: z.string(),
    status: z.enum(["running","starting","stopped","missing","error"]),
    health: z.enum(["healthy","unhealthy","starting"]).nullable(),
  }),
  createdAt: z.string(),
  updatedAt: z.string(),
});

envVarSchema = z.object({
  id: z.string(),
  serviceResourceId: z.string(),
  key: z.string(),
  value: z.string(),
});
```

### Endpoints

| Method | Path                                                          | Notes |
| ------ | ------------------------------------------------------------- | ----- |
| GET    | `/projects/{projectId}/services`                              | list  |
| GET    | `/projects/{projectId}/services/{resourceId}`                 | get   |
| POST   | `/projects/{projectId}/services`                              | create — name, image, ports[], env, replicas, restart, healthcheck, resources |
| PATCH  | `/projects/{projectId}/services/{resourceId}`                 | update — any partial of create input, triggers `updateSwarmService` |
| DELETE | `/projects/{projectId}/services/{resourceId}`                 | delete; rejects with `IN_USE` if other services reference this one |
| POST   | `/projects/{projectId}/services/{resourceId}/restart`         | force task replacement (bumps `forceUpdateCounter`) |
| POST   | `/projects/{projectId}/services/{resourceId}/expose`          | flip `publicEnabled=true`, create proxy_route, reconcile Caddy |
| POST   | `/projects/{projectId}/services/{resourceId}/unexpose`        | flip false, delete proxy_route, reconcile |
| GET    | `/projects/{projectId}/services/{resourceId}/env`             | env list |
| PUT    | `/projects/{projectId}/services/{resourceId}/env/{key}`       | env set — also triggers redeploy of this service and its dependents |
| POST   | `/projects/{projectId}/services/{resourceId}/env`             | env bulk-replace |
| DELETE | `/projects/{projectId}/services/{resourceId}/env/{key}`       | env unset |

### Errors

| Code            | When |
| --------------- | ---- |
| `NOT_FOUND`     | Unknown project, service, or env var |
| `CONFLICT`      | Duplicate service name in project; duplicate env key |
| `IN_USE`        | Delete blocked because another service references this one |
| `INVALID_INPUT` | Bad image string, invalid env key format, no primary HTTP port when exposing |
| `REF_MISSING`   | Env value references a resource that doesn't exist in the project |
| `REF_CYCLE`     | Env reference graph has a cycle |
| `NO_HTTP_PORT`  | `expose()` called but service has no `appProtocol='http'` port |
| `SERVER_ERROR`  | Docker/Swarm failure surfaced unchanged |

## 6. Swarm Provisioner

`packages/api/src/swarm/service.ts` — same shape as `swarm/postgres.ts`:

```ts
provisionSwarmService(input): Promise<SwarmServiceRuntime>
updateSwarmService(input): Promise<SwarmServiceRuntime>
restartSwarmService(input): Promise<SwarmServiceRuntime>
destroySwarmService(input: { serviceName }): Promise<void>
inspectSwarmServiceRuntime(input): Promise<SwarmServiceRuntime>
```

`SwarmServiceRuntime`:

```ts
{
  serviceId: string | null,
  serviceName: string,
  networkName: string,
  status: "running" | "starting" | "stopped" | "missing" | "error",
  health: "healthy" | "unhealthy" | "starting" | null,
}
```

Docker service create spec (built from `service_resource` row + resolved env):

```ts
{
  Name: serviceName,
  Labels: {
    "otterdeploy.managed": "true",
    "otterdeploy.resource.type": "service",
    "otterdeploy.project": projectSlug,
    "otterdeploy.resource.id": resourceId,
  },
  TaskTemplate: {
    ContainerSpec: {
      Image: image,
      // Docker spec: Command = ENTRYPOINT, Args = CMD.
      // User-facing fields use the conventional meaning, so swap on the way out.
      Command: entrypoint ?? undefined,
      Args: command ?? undefined,
      Env: Object.entries(resolvedEnv).map(([k,v]) => `${k}=${v}`),
      Healthcheck: healthcheck.cmd ? {
        Test: ["CMD", ...healthcheck.cmd],
        Interval: healthcheck.intervalMs * 1_000_000,  // ns
        Timeout: healthcheck.timeoutMs * 1_000_000,
        Retries: healthcheck.retries,
        StartPeriod: healthcheck.startMs * 1_000_000,
      } : undefined,
      Hostname: internalHostname,
    },
    Networks: [{
      Target: networkName,
      Aliases: [serviceName, internalHostname, resourceName],
    }],
    RestartPolicy: {
      Condition: restart.condition,
      MaxAttempts: restart.maxAttempts ?? undefined,
      Delay: restart.delayMs * 1_000_000,
    },
    Resources: {
      Limits: {
        NanoCPUs: cpuLimit ? cpuLimit * 1e9 : undefined,
        MemoryBytes: memoryLimitMb ? memoryLimitMb * 1024 * 1024 : undefined,
      },
      Reservations: {
        NanoCPUs: cpuReservation ? cpuReservation * 1e9 : undefined,
        MemoryBytes: memoryReservationMb ? memoryReservationMb * 1024 * 1024 : undefined,
      },
    },
    ForceUpdate: forceUpdateCounter,
  },
  Mode: { Replicated: { Replicas: replicas } },
  EndpointSpec: {
    // HTTP ports flow client → Caddy → overlay → service (no host publish).
    // Only non-HTTP ports get an ingress-published port on the swarm.
    Ports: ports
      .filter(p => p.appProtocol === "tcp")
      .map(p => ({
        Protocol: p.protocol,
        TargetPort: p.containerPort,
        PublishMode: "ingress",
      })),
  },
}
```

HTTP ports are reached via the internal alias + Caddy, **not** via
published Swarm ports. Only non-HTTP `appProtocol='tcp'` ports get a
`PublishMode: "ingress"` entry — primary HTTP traffic flows
client → Caddy → Swarm overlay → service.

Update path uses Docker's service update endpoint with the new spec.
Restart bumps `forceUpdateCounter` and calls update with no other
changes — Swarm's `ForceUpdate` triggers task replacement.

Error handling: all Docker calls return `Result<T, E>` from
`@otterdeploy/docker`. Use `.isErr()` / `.isOk()` — **never** `.unwrap()`.
On failure during `provisionSwarmService`, mark the `resource.status`
`'invalid'` and bubble the error. Retry on next `update` is idempotent
(re-uses existing service by `serviceName`).

## 7. Caddy / Networking

### Internal alias

`internalHostname = <resource-name>` (project network is isolated, so
short names are unique within the project). The service is reachable as
`http://<resource-name>:<port>` from other services in the same project.

### Public exposure

`expose()`:

1. Service must have at least one `appProtocol='http'` port. If not →
   `NO_HTTP_PORT`.
2. Pick the primary HTTP port (or only HTTP port if none flagged).
3. Generate `publicDomain = "<resource-name>-<project-slug>.<PLATFORM.service.publicBaseDomain>"`.
   Collision-resistant because `(project-slug, resource-name)` is
   unique. Suffix with short random if collision detected.
4. Set `publicEnabled=true`, `publicDomain=…` on `service_resource`.
5. Insert `proxy_route` row: `type='http'`, `domain=publicDomain`,
   `upstreamHost=internalHostname`, `upstreamPort=primary HTTP port`,
   `protocol='http'`, `enabled=true`.
6. Trigger `reconcile()` from `packages/api/src/caddy/`.

`unexpose()`:

1. Delete `proxy_route` rows where `resourceId = serviceResourceId`.
2. Clear `publicEnabled=false`, `publicDomain=null`.
3. Trigger `reconcile()`.

### New constant

Add to `packages/api/src/constants.ts`:

```ts
service: {
  publicBaseDomain: "apps.otterdeploy.dev",
  serviceNamePrefix: "otterdeploy-svc-",
}
```

## 8. Errors / Edge Cases

| Case | Behavior |
| ---- | -------- |
| Create with duplicate name in project | `CONFLICT` (unique by `(projectId, name)` on `resource` table — add unique index if missing) |
| Get unknown service | `NOT_FOUND` |
| Swarm create fails partway | Mark `resource.status='invalid'`, return error. Retry on `update` is idempotent (`provisionSwarmService` early-returns if `serviceName` exists). |
| Update collides with in-flight update (Docker `Spec.version` mismatch) | Re-fetch service, retry once; bubble after second failure. |
| Reference to nonexistent resource | `REF_MISSING` on env set/update; on referenced-resource delete: block with `IN_USE` |
| Reference cycle | `REF_CYCLE` with the chain in `cause` |
| Delete service referenced by another | `IN_USE` listing referrers; no force flag in v1 |
| Expose without HTTP port | `NO_HTTP_PORT` |
| Replica = 0 update | Allowed — treated as "stopped"; runtime `status='stopped'` once tasks drain |
| Image not pullable | Swarm reports task failure; runtime `status='error'`, `health='unhealthy'`; surface in get/list response |
| Restart on a `status='draft'` service (never successfully provisioned) | Promote to first-time provision (idempotent path) |
| Postgres password rotation | Future-proofed via auto-redeploy of dependents; no rotation API today |

## 9. Testing

### Unit

- `lib/variables/parser.test.ts` — token extraction, escapes, malformed refs
- `lib/variables/resolver.test.ts` — single-hop, multi-hop, missing ref, cycle
- `lib/variables/graph.test.ts` — dependents lookup
- `lib/variables/exporters.test.ts` — Postgres exporter shape, service exporter shape
- `lib/queries/service.test.ts` — CRUD against test Postgres (Testcontainers pattern from `caddy/__tests__/`)

### Integration

- `swarm/__tests__/service.test.ts` — provision/update/restart/destroy against a real Docker Swarm (uses same test infra as `swarm/__tests__/postgres.test.ts`)
- End-to-end: create project → create Postgres → create service with `DATABASE_URL=${{db.DATABASE_URL}}` → expose → curl auto subdomain → assert running
- Ref-change fan-out: create two services where B references A; update A; assert B's task gets replaced

### Manual smoke

1. `bun db:push` to apply migration
2. Create a project via web UI (or oRPC client)
3. `POST /projects/{id}/services` with `nginx:1.27`, port 80 http primary
4. `POST .../expose`
5. `curl https://<auto-domain>` → nginx default page

## 10. Open Questions / Future Work

- **Image pull secrets** — private registries need credentials. v1
  assumes public images. Add `registry_credential` table later.
- **Cert provisioning** — Caddy auto-handles via ACME; ensure
  `apps.otterdeploy.dev` wildcard DNS is configured. (Out of band.)
- **Project rename** — would change subdomain. Defer; project rename
  isn't supported today.
- **Deployment history** — every `update` is a "deployment". Adding a
  `deployment` table later gives rollback. Not in v1.
- **Resolver caching** — currently re-scans env vars on every redeploy.
  Cheap at small scale; revisit when projects have >100 services.
- **Concurrent updates** — two simultaneous updates serialized via
  Docker's `Spec.version`. No explicit otterdeploy-side lock in v1.
