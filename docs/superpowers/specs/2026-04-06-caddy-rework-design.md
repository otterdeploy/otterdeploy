# Caddy Rework Design Spec

## Goal

Replace the over-engineered Caddy integration with a simple reconciliation-based approach: DB is source of truth, Caddyfile is a derived artifact, per-project validation prevents one broken project from taking down others.

## Context

The current implementation has ~800 lines across `config.ts` and `service.ts` that:
- Build Caddyfile text via string concatenation with file-based `import` directives
- Write project config fragments to temp directories on disk
- Adapt Caddyfile to JSON via Caddy's `/adapt` API just to extract "claims" (domains, ports)
- Validate claims for conflicts, then load the whole config via `/load`
- Sync files to a persistent config directory

This is being replaced with a pipeline: **DB rows -> build one Caddyfile string -> validate per-project via `/adapt` -> POST `/load`**.

## Architecture

### Data Model

New `proxy_route` table replaces the `caddy_config` table:

| Column | Type | Description |
|--------|------|-------------|
| id | text (PK) | `proxy_route_{cuid}` |
| projectId | text (FK -> project) | Owning project |
| resourceId | text (FK -> resource, nullable) | Associated resource (if any) |
| type | enum: `http`, `layer4` | Route type |
| domain | text | e.g. `myapp-acme.otterdeploy.dev` |
| upstreamHost | text | e.g. `myapp.acme.otterdeploy.internal` |
| upstreamPort | integer | e.g. 3000 or 5432 |
| protocol | enum: `tcp`, `http` | Determines proxy directive |
| layer4Alpn | text (nullable) | e.g. `postgresql` for Layer4 routes |
| enabled | boolean, default true | Toggle without deleting |
| createdAt | timestamp | |
| updatedAt | timestamp | |

Unique constraint on `domain` — no two routes can claim the same domain.

### Components

**`packages/api/src/caddy/builder.ts`** — Pure functions. Takes `proxy_route` rows, returns a Caddyfile string. No I/O.

- `buildCaddyfile(routes, adminBind)` -> full Caddyfile string
- `buildHttpBlock(route)` -> single site block
- `buildLayer4Route(route)` -> single Layer4 matcher + route
- `buildGlobalBlock(layer4Routes, adminBind)` -> global options with listener_wrappers

**`packages/api/src/caddy/client.ts`** — Thin HTTP client for Caddy admin API.

- `adaptCaddyfile(caddyfile, adminUrl)` -> adapted JSON or error
- `loadCaddyfile(caddyfile, adminUrl)` -> void or error

**`packages/api/src/caddy/reconciler.ts`** — The controller.

- `reconcile()` -> `ReconcileResult`
  1. Query all enabled `proxy_route` rows grouped by projectId
  2. For each project: build its fragment, validate via `/adapt`
  3. Assemble final Caddyfile from valid fragments + global block
  4. POST to `/load`
  5. Return which projects were applied vs skipped

**`packages/db/src/schema/caddy.ts`** — Replaced with `proxy_route` table definition.

**`packages/db/src/proxy-route.ts`** — CRUD queries for proxy_route table.

### Flow: Creating a Postgres Resource

1. Docker container provisioned (existing `docker/postgres.ts` — unchanged)
2. Insert `proxy_route` row: type=layer4, domain=publicHostname, upstream=internalHostname:5432, protocol=tcp, layer4Alpn=postgresql
3. Call `reconcile()` — builds Caddyfile, validates, loads into Caddy
4. If reconcile skips this project, mark resource status as `invalid`

### Flow: Creating an HTTP Service Resource (future)

1. Container provisioned
2. Insert `proxy_route` row: type=http, domain=serviceDomain, upstream=internalHostname:port, protocol=http
3. Call `reconcile()`

### Caddyfile Output

```caddyfile
{
    admin 0.0.0.0:2019
    servers {
        listener_wrappers {
            layer4 {
                @pg_primary_acme tls {
                    alpn postgresql
                    sni primary-acme.db.otterdeploy.dev
                }
                route @pg_primary_acme {
                    tls {
                        connection_policy {
                            alpn postgresql
                        }
                    }
                    proxy primary-acme.otterdeploy.internal:5432
                }
            }
            tls
        }
    }
}

myapp-acme.otterdeploy.dev {
    reverse_proxy myapp.acme.otterdeploy.internal:3000
}
```

### Docker Compose

Uncomment the Caddy service. Key changes:
- Remove `--resume` flag (config is always rebuilt from DB on server start)
- Use `--config /etc/caddy/Caddyfile --adapter caddyfile`
- Mount `./infra/caddy/config:/etc/caddy`
- Expose ports 80, 443, 2019
- Join `otterdeploy-resources` network so Caddy can reach provisioned containers
- Uncomment volumes `otterdeploy-caddy-data` and `otterdeploy-caddy-state`

### What Gets Deleted

- `packages/api/src/caddy/config.ts` — entire file (500 lines)
- `packages/api/src/caddy/service.ts` — entire file (300 lines)
- `packages/db/src/schema/caddy.ts` — old `caddy_config` table
- `packages/db/src/caddy.ts` — old CRUD queries
- All references to `caddy_config` table, claim extraction, file sync, temp dirs

### What Gets Modified

- `packages/api/src/routers/project/service.ts` — `createPostgresResource` and `ensureDockerRuntimeForRecord` switch from raw Caddyfile snippet management to inserting/updating `proxy_route` rows + calling `reconcile()`
- `packages/api/src/routers/project/contract.ts` — update caddy-related schemas to match new reconciler result
- `packages/api/src/routers/project/index.ts` — update caddy route handlers
- `packages/db/src/schema/index.ts` — export new schema, remove old
- `packages/db/src/index.ts` — export new queries, remove old
- `packages/shared/src/id.ts` — add `proxyRoute` prefix
- `packages/env/src/server.ts` — keep existing Caddy env vars, remove unused ones
- `docker-compose.yml` — uncomment Caddy service
- `infra/caddy/config/Caddyfile` — seed file for initial Caddy startup

### Env Vars

Keep:
- `CADDY_ADMIN_URL` — for API calls
- `CADDY_ADMIN_BIND` — for the Caddyfile global block

Remove:
- `CADDY_CONFIG_DIR` — no longer writing files from the API
- `CADDY_RUNTIME_CONFIG_DIR` — same
- `CADDY_RESERVED_HOSTS` — validation is now per-project via `/adapt`, not claim-based
- `CADDY_RESERVED_LAYER4_PORTS` — same

### Testing

- `builder.ts` — unit tests for each build function (pure functions, easy to test)
- `client.ts` — no unit tests (thin HTTP wrapper), tested via integration
- `reconciler.ts` — unit test with mocked client, verify per-project skip behavior
- Existing `config.test.ts` — deleted and replaced
