# Built-in Database Viewer

**Status:** Design proposal (not yet implemented — no query/introspection backend exists; the
`database` terminal source is declared but unwired)

**Last verified:** 2026-06-07

**TL;DR:** Give users a native, in-platform way to browse and edit the data in their deployed
databases — no separate Drizzle Studio / TablePlus / `psql` process. Decision taken: **native**
(not an embedded Adminer/Drizzle-Gateway sidecar), **Postgres first**, **read + write from day one**.
Most load-bearing infrastructure already exists: a Docker-exec proxy
(`apps/server/src/handlers/terminal-ws.ts`), oRPC event-iterator streaming, an evlog audit pipeline,
and credentials on `databaseResource`. v1 likely needs **no new DB tables** — it is transport + an
oRPC router + UI + a permission policy. The two genuine unknowns are the same one backups hit
(reaching a DB container on a *specific* Swarm node) and the fact that **read+write makes RBAC,
write-guardrails, and audit core, not later** — a SQL surface that can `DROP TABLE` is the most
dangerous feature on the platform.

---

## Table of contents

1. [Starting point](#1-starting-point)
2. [Mental model](#2-mental-model)
3. [How competitors do it](#3-how-competitors-do-it)
4. [Transport — reaching the database](#4-transport--reaching-the-database)
5. [Data model](#5-data-model)
6. [API surface](#6-api-surface)
7. [Write safety & RBAC](#7-write-safety--rbac)
8. [Frontend](#8-frontend)
9. [Hard parts / open decisions](#9-hard-parts--open-decisions)
10. [Phasing](#10-phasing)
11. [Where this lives in code](#11-where-this-lives-in-code)

---

## 1. Starting point

Today the Postgres resource panel
(`apps/web/src/features/projects/components/resource-panels/postgres-settings/`) shows **metadata
only** — identity, storage, public access, extensions, a disabled maintenance card. There is no way
to see a single row of the user's data without running an external tool against the public
connection string (which requires `publicEnabled` + exposing the DB).

Two things are already half-built and point straight at this feature:

- **`SessionSource` already has a `database` variant** (`apps/web/src/features/terminal/types.ts:18`):
  `{ kind: "database"; engine; service; project }`. Someone already anticipated an in-app
  `psql`/`redis-cli`/`mongosh` session. It is declared but never resolved to a container exec.
- **The exec transport works.** `startContainerExec` (`apps/server/src/handlers/terminal-ws.ts:169`)
  already runs a process *inside* any container on the Swarm via the `@otterdeploy/docker` client and
  duplex-streams its I/O over a WebSocket. A query engine reuses this exact path.

So unlike backups (2,289 lines of mock + zero backend), here the backend primitives exist; the work
is a new read/write query API and the grid/console UI on top of it.

---

## 2. Mental model

A database viewer is **three concerns**, kept separate:

- **Introspection** — read the live catalog (`information_schema` / `pg_catalog`) to list schemas,
  tables, views, columns, types, primary/foreign keys, indexes, row estimates. Cached; cheap;
  always read-only. This is what makes the UI schema-aware (grids, autocomplete, edit-ability).
- **Reading data** — paginated, sorted, filtered row browsing + ad-hoc `SELECT`. Runs under a
  hard read-only envelope (read-only transaction + statement timeout + row cap) so it is *physically
  unable* to mutate or hang, regardless of what SQL the user typed.
- **Writing data** — inline cell edits, row insert/delete (server-generated, parameterized,
  primary-key-guarded), and the open SQL console's DML/DDL. Gated by a per-resource capability,
  wrapped in explicit transactions, destructive verbs require typed-name confirm, **every statement
  audited via evlog**.

The browser never holds credentials. All three concerns run server-side through one oRPC router; the
DB password resolves at request time from `databaseResource` and stays on the server (same discipline
as the backup execution worker resolving creds at run time).

**The differentiator:** the read+write path flowing through *our* audited oRPC layer means every
query — who ran what SQL against which database, the outcome, the duration — lands in evlog. No
competitor and no embedded third-party viewer can give that (their queries happen inside the sidecar,
invisible to us). This is the reason we chose native over a Gateway sidecar.

---

## 3. How competitors do it

The research bears out that this is an **opportunity gap**, not table-stakes:

- **Dokploy** (`research/dokploy/`) — "create and manage databases" (MySQL/Postgres/Mongo/MariaDB/
  Redis), but **no built-in data viewer**. Users bring their own tool.
- **Coolify** (`research/coolify/`) — deployment + DB provisioning, **no data browser**.
- **Slipway** (`research/slipway/`) — the only one with a data UI: **"Bridge"** (a Laravel-Nova-style
  auto-generated CRUD admin) and **"Dock"** (a SQL console). But Bridge is *ORM-model-aware* — it
  generates from Waterline model definitions. That doesn't generalize to arbitrary customer databases
  with no schema we control, so we can't copy it directly. Its *ambition* (data management in the same
  place you deploy) is the bar.

**Off-the-shelf relational viewers** (Drizzle Gateway, Adminer, pgweb) were considered and declined:
relational-only (no Redis/Mongo), a separate auth model, and — fatally — queries bypass our evlog
audit. Drizzle Studio specifically is not a drop-in React component (it's a hosted app / self-hosted
gateway), so "embed Studio as a widget" was never actually on the table.

**Adopted:** native viewer; resolve creds at request time (Coolify/Dokploy idiom); introspection
drives the UI (Slipway's model-awareness, but sourced from the live catalog instead of an ORM).

---

## 4. Transport — reaching the database

This is the crux and the biggest unknown — the **same** unknown backups flagged in its §8.1: a DB
runs as a Swarm service on a *specific node*, and the otterdeploy-server must reach it.

Two transports, used for different jobs:

### 4.1 Wire protocol (preferred for the structured viewer)

The server opens a real Postgres connection (the `postgres` client already in the workspace) and
speaks the wire protocol. This is the **only** way to get what a quality grid needs: typed columns
(even for empty results), command tags (`INSERT 0 1`), affected-row counts, `NOTICE`/`RAISE`
messages, and errors with a character position. Shelling out to `psql` cannot give typed metadata
reliably.

Reachability is the catch. Options, roughly in order of cleanliness:

1. **Same node** as the server (or server attached to the project overlay) → direct connect via
   `internalHostname:internalPort`. Clean, fast.
2. **`localConnectionString`** path (the PLATFORM-internal host the swarm reconciler already uses).
3. **Public Caddy Layer-4 route** — only when `publicEnabled`; not acceptable as the general path
   (forces exposure).
4. **Exec-as-transport** — `docker exec` a byte-pipe into the container's network namespace and run
   the wire protocol *over* that pipe (universal reach, typed fidelity). Elegant, but needs a piping
   helper (`socat`/equivalent) the stock Postgres image doesn't ship → likely needs a tiny sidecar or
   a static helper binary. Park unless §9.1 forces it.

**Recommendation:** wire-protocol over the internal route (1/2). Whether the server can reach an
arbitrary DB node across the cluster is **the** decision to make before building the read path — it
is identical to the backup worker's transport problem, so solve it once for both.

### 4.2 Container exec (the REPL, and a degraded fallback)

Reuse `startContainerExec` verbatim for **Phase 0**: resolve the resource's running container/task
(via the `@otterdeploy/docker` client + the `otterdeploy.managed` / `otterdeploy.resource.*` /
project labels, as `packages/api/src/swarm/database.ts` already does for inspection), then exec the
engine client — `psql`, `redis-cli`, `mongosh`. Creds need not leave the server *or* be re-typed: the
container already has `POSTGRES_USER`/`POSTGRES_DB` in its env, so `psql -U "$POSTGRES_USER"
"$POSTGRES_DB"` just works inside it.

Exec can also serve a **degraded structured path** when wire is unreachable: run a non-TTY exec
(`Tty: false`) of `psql` emitting CSV (`\copy (<query>) to stdout csv header`) or JSON
(`row_to_json`), and demux Docker's multiplexed stdout/stderr the same way `resource-logs` already
does. Lower fidelity (no types, single-statement, fragile quoting) — fallback only.

---

## 5. Data model

**v1 needs no new tables.** Introspection is live (the catalog *is* the source of truth), and audit
is evlog, not a table. This is the big difference from backups.

Credentials already live on `databaseResource` (`packages/db/src/schema/project.ts:226`): `engine`,
`databaseName`, `username`, `password`, `internalHostname`/`internalPort`, `upstreamHost`/`upstreamPort`.
That row *is* the connection target.

> ⚠️ `password` is **plaintext at rest** today. A read-only metadata panel could tolerate that; a
> read+write SQL surface raises the stakes. Encrypting it (AES-GCM, reusing the `containerRegistry`
> crypto the backups doc points to — "do not store plaintext like Dokploy") should land before, or
> alongside, the write path. Track as §9.4.

Later phases add small, optional tables:

- **`database_saved_query`** (Phase 3) — `id`, `organizationId`, `resourceId` FK (cascade),
  `name`, `sql` text, `createdBy`, timestamps. Prefixed CUID2 id (`sqlquery`), `createdAt`/`updatedAt`
  with `$onUpdate`, per existing schema conventions.
- **Query history** — derivable from evlog; only add a `database_query_log` table if a per-user
  history *UI* is wanted (open product question, §9.3).

RBAC reuses Better Auth org roles + a resource access check; a dedicated grant table is only needed if
we want per-resource read/write grants finer than org role (§9.3).

---

## 6. API surface

New router `packages/api/src/routers/database/` — `contract.ts` + `index.ts` + `service.ts` +
`errors.ts`, mirroring the `env` router. Every handler: `orgScopedProcedure`, resource-ownership +
capability check, `context.log.set({ target, statement, kind })` **first**, returns `Result<T,E>`
from the service, dispatches typed errors with `matchError`. **No raw try/catch** —
`Result.tryPromise` with a non-throwing catch (see [[better-result-no-try-catch]]).

- `database.introspect` — `{ resourceId }` → schemas → tables/views with columns (name, type,
  nullable, default), primary keys, foreign keys, indexes, row estimates. Cached.
- `database.tableRows` — `{ resourceId, schema, table, cursor?/page, sort[], filters[] }` → typed
  rows + column metadata + estimated total. Server builds a **parameterized** `SELECT` from the
  structured input (never string-concatenated) under the read-only envelope.
- `database.query` — `{ resourceId, sql, params?, maxRows? }` → the SQL console. Returns columns
  (name + type), rows, command tag, `rowsAffected`, notices, and structured errors (message +
  position). **Streams** large result sets via an oRPC event iterator, reusing the
  `resource-logs` / `postgres/create-stream` idiom; flags truncation at `maxRows`.
- `database.mutateRow` — `{ resourceId, schema, table, op: insert|update|delete, pk, set }` →
  backs inline grid editing without the user writing SQL. Parameterized, primary-key-guarded.
- `database.savedQueries.{list,create,update,delete}` — Phase 3.

Typed errors (`TaggedError`): `DatabaseUnreachableError`, `QueryTimeoutError`,
`ReadOnlyViolationError`, `MissingPrimaryKeyError`, `DatabasePermissionDeniedError`,
`ResultTruncatedError` (or a truncation flag on success). Register `database: databaseRouter` in
`packages/api/src/routers/index.ts`.

---

## 7. Write safety & RBAC

This section exists *because* we chose read+write from day one. A built-in surface that can
`UPDATE`/`TRUNCATE`/`DROP` is the highest-blast-radius feature on the platform; the guardrails are
core, not polish.

**Read envelope (always on for the read path).** Before any browse/`SELECT`, the session runs
`SET default_transaction_read_only = on`, `SET statement_timeout = <cap>`, and
`SET idle_in_transaction_session_timeout = <cap>`. A read session is then *physically* unable to
write or hang, no matter what SQL arrives — far stronger than parsing the statement and hoping.

**Write capability (RBAC).** A per-resource capability — `database:read` / `database:write` /
`database:ddl` — resolved from Better Auth org roles (owner/admin write by default; members read).
Whether to support finer per-resource grants is §9.3. The write path is rejected server-side
(`DatabasePermissionDeniedError`) before a connection is even opened if the actor lacks the cap.

**Generated writes (inline edit / insert / delete).** Always parameterized; never value
concatenation. Requires a primary key — refuse with `MissingPrimaryKeyError` if the table has none
(offer an explicit `ctid` fallback with a visible warning). Wrapped in an explicit transaction so a
failed edit rolls back cleanly.

**SQL console writes.** Run in autocommit, but **destructive verbs gate**:
`DROP`/`TRUNCATE`/`DELETE`-without-`WHERE`/`UPDATE`-without-`WHERE` require a typed-name confirm in
the UI — and that confirm is **enforced server-side**, not UI-only (the same lesson backups learned
for in-place restore). Statement classification is pre-flight (to gate by capability) and the wire
command tag is the post-flight record of truth.

**Audit (the payoff).** *Every* statement — read and write — calls `context.log.set` with `{ target
resource, actor, statement, kind, rowsAffected, durationMs, outcome }` and flows through the evlog
drain to the audit table. This is the feature embedded viewers structurally cannot match.

**Connection identity.** v1 connects as the stored owner role. Future: provision a least-privilege
read-only DB role so the read path can't write *at the database level* either (defense in depth).

**Auth on the path.** `terminal-ws.ts:300` notes PTY auth is "when re-enabled." For a write-capable
data surface, auth (org + project + resource ownership + capability) **must** be enforced on the
query/exec path before this ships — non-negotiable. Track as §9.5.

---

## 8. Frontend

A new **"Data"** tab in the resource panel alongside the existing postgres-settings tabs, built from
the existing shadcn/coss primitives:

- **Object sidebar** — schemas → tables/views with row-count badges, sourced from
  `database.introspect`.
- **Data grid** — TanStack Table over `database.tableRows`: cursor pagination, column sort, a filter
  builder, and **type-aware cells** (json/jsonb pretty-print, timestamps, booleans, `NULL` sentinel,
  bytea/binary). Inline cell edit, add-row, delete-row → `database.mutateRow`. Read-only badge when
  the actor lacks `database:write`.
- **SQL console** — CodeMirror with a Postgres SQL mode and **schema-aware autocomplete** fed from
  introspection; run / run-selection; results grid (reuses the data-grid renderer); streamed results
  with a truncation banner; destructive-confirm modals.
- **Export** — CSV / JSON of the current result set.

**Phase 0 (REPL, near-free):** resolve the `database` `SessionSource`
(`apps/web/src/features/terminal/`) to a container and open the existing `/pty` WebSocket exec'ing the
engine client. Users get a real interactive shell immediately, before any grid exists.

For other engines (§10 Phase 4) the grid is replaced by engine-appropriate views — a Redis key
browser, a Mongo collection/document browser — over the **same** transport and auth/audit envelope.
"One viewer" means one shell and one set of guarantees, not one grid for everything.

---

## 9. Hard parts / open decisions

1. **Server → DB-node reachability across Swarm** *(biggest unknown — decide before the read path).*
   Identical to backups §8.1. Pick the wire-protocol route (§4.1) and confirm the server can reach an
   arbitrary node's DB, or commit to exec-as-transport. Solve once for both features.
2. **Connection role / least privilege.** v1 uses the owner role; ideally provision a read-only role
   for read sessions (defense in depth at the DB layer).
3. **RBAC granularity.** Org roles only, or per-resource read/write grants? Needs product input;
   determines whether a `resource_grant` table is required.
4. **Password encryption at rest.** Plaintext today (§5). Encrypt before/with the write path.
5. **Auth on the query/exec path.** Currently disabled on `/pty` (§7). Must be on before ship.
6. **Result-size & timeout policy.** Default `statement_timeout`, `maxRows` cap, streaming threshold,
   truncation UX.
7. **Multi-engine UI divergence.** Relational grid vs Redis/Mongo browsers — Phase 4 scope.

---

## 10. Phasing

| Phase | Scope | Risk |
| --- | --- | --- |
| 0 | Wire the `database` terminal source → exec `psql`/`redis-cli`/`mongosh` over existing `/pty`. In-app REPL, near-zero new code | low |
| 1 | `database.introspect` + `database.tableRows` + read-only SQL console; wire-protocol transport (§4.1) under the read envelope (§7); data grid + object sidebar UI | medium (§9.1) |
| 2 | Write path: inline edit/insert/delete (`database.mutateRow`, PK-guarded) + console DML/DDL + `database:write` capability + destructive confirms + full evlog audit | **high** (§7) |
| 3 | Export (CSV/JSON), saved queries (`database_saved_query`), schema-aware autocomplete, optional query history | low |
| 4 | Other engines: Redis key browser, Mongo collection browser, over the same transport/auth/audit | medium |

Auth-on-path (§9.5) and password encryption (§9.4) are prerequisites that must land **no later than
Phase 2**.

---

## 11. Where this lives in code

Nothing below exists yet (except the reused primitives) — planned layout, mirroring the `env` router
and reusing the terminal/exec + log-streaming infrastructure.

| Concern | Package / file (planned) | Mirrors / reuses |
| --- | --- | --- |
| Contract | `packages/api/src/routers/database/contract.ts` | `routers/env/contract.ts` |
| Handlers | `packages/api/src/routers/database/index.ts` | `routers/env/index.ts` (org-scoped) |
| Query service | `packages/api/src/routers/database/service.ts` | `routers/env/handlers.ts` |
| Errors | `packages/api/src/routers/database/errors.ts` | `routers/project/errors.ts` |
| Router registration | `packages/api/src/routers/index.ts` (`database: databaseRouter`) | existing barrel |
| Wire transport | `packages/api/src/database/connect.ts` (planned) | reuses workspace `postgres` client |
| Exec transport (REPL + fallback) | `apps/server/src/handlers/terminal-ws.ts` (`startContainerExec`) | **exists** |
| Container/task resolution | `@otterdeploy/docker` + service labels | `packages/api/src/swarm/database.ts` |
| Result streaming | reuse the `resource-logs` / `postgres/create-stream` event-iterator idiom | **exists** |
| Saved queries schema (P3) | `packages/db/src/schema/project.ts` (or new `database.ts`) + id prefix `sqlquery` | existing schema conventions |
| Frontend (Data tab) | `apps/web/src/features/projects/components/resource-panels/postgres-settings/data/` | existing panel tabs |
| Frontend (REPL, P0) | `apps/web/src/features/terminal/` (resolve `database` `SessionSource`) | **exists, unwired** |
