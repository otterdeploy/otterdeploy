# Shared Database Servers

**Status:** Implemented (Postgres, MariaDB/MySQL, MongoDB). Read below as what shipped, not
as a plan.

**Last verified:** 2026-08-26

**TL;DR:** One engine container can hold many logical databases, each with its own database,
login role and credentials. A dozen low-traffic services no longer means a dozen Postgres
processes each holding their own `shared_buffers` on the same box. Nothing about a dedicated
database changed: the feature is one nullable column.

## The model

`database_resource.host_resource_id`:

- **NULL** — this row IS its own server: one container, one volume, one placement. Every row
  that existed before this feature, unchanged. No backfill, no rename, no hostname churn.
- **Set** — this row is a logical database inside another `database_resource`'s container. It
  has no container, no volume and no placement of its own. `internal_hostname` /
  `internal_port` are copies of the host's; `database_name` / `username` / `password` are its
  own.

Deliberately not a foreign key (same call as `branched_from_resource_id`): a RESTRICT would
fire during an ordinary project delete, and a CASCADE would silently drop a tenant row while
its data is still live on the host. The invariant that matters — a server can't be deleted
while it still has tenants — lives in `resource-delete.ts`, where it can be reported to the
operator instead of aborting a transaction.

Two tenants can never collide on one server: database and user names were already derived as
`<projectSlug>_<resourceSlug>_db|user`, and project slugs are unique.

## What came free

Because a tenant is the *same row* in the *same table*:

- **Variable refs.** `postgresExports` builds `DATABASE_URL` / `PGHOST` / … from the row, so
  `${{name.DATABASE_URL}}` resolves identically. Consumers never learn the difference.
- **Backups.** The engine already takes logical dumps per database resource (`backups/db.ts`,
  rustic + `pg_dump`), not volume snapshots. Zero engine changes.
- **The data viewer, backups and ephemeral credentials** all reach a container through
  `findResourceContainerId`. That one function now resolves `host_resource_id` first, so all
  three work on a tenant without any of them knowing tenants exist.

One exception needed real work: an ephemeral credential is minted with `CREATE ROLE`, and a
tenant's own role deliberately has no role attributes. `getTarget` now returns the HOST's
superuser as the *login* identity while keeping the tenant's role as the *owner* the
credential is granted membership in.

## Isolation

`swarm/database-engines/tenancy.ts` owns every engine-specific statement. Postgres is the one
that needs care: it grants `CONNECT` on every database to `PUBLIC`, so without an explicit
revoke each tenant role could open a session against every other database on the server. The
create plan revokes it on the tenant's database *and* on the host's own. MariaDB and MongoDB
isolate by construction (per-schema grants; `dbOwner` on exactly one database).

Verified against real containers, not just unit tests: a tenant can reach its own database
and is refused on both its neighbour's and the host's, on all three engines.

## What a tenant deliberately cannot do

Each of these acts on the CONTAINER, which on a shared server belongs to everyone:

| Operation | Behaviour | Why |
|---|---|---|
| Restart / env change / extension image swap | Refused (`HostedDatabaseNotRollableError`) | Would roll the host and take every other database down. Guarded in `rollDatabaseContainer`, the single choke point all three go through. |
| Public exposure | Refused (`HostedDatabaseNotPublishableError`) | A layer4 route maps one hostname to one upstream; on a shared server that upstream serves every tenant. |
| ZFS preview branching | Forced to the `copy` driver | A volume clone would branch the neighbours too, and hand the preview data that isn't its to see. |
| Deleting the server under it | Refused (`DatabaseHasTenantsError`) | Its volume holds their bytes, and they are separate resources — possibly in other projects. |

## Manifest

`host: <server name>` on the postgres/mariadb/mongodb variants, plus `connectionLimit`. By
NAME, not id, so a manifest checked into a repo stays portable.

Create-time only. A changed `host` is staged (so the drift is visible) and **refused at
apply** with an explanation: re-homing means copying data between servers and cutting over
every consumer's connection string, which an apply must not do because one line changed.

## Connection budget

Postgres ships with `max_connections = 100`, and ten services with pools of ten is the whole
server. `database.listHosts` reports live used/max per server, and each tenant can carry a
`connectionLimit` applied at the engine (`ALTER DATABASE … CONNECTION LIMIT`,
`MAX_USER_CONNECTIONS`). A server that can't be probed reports `null` — unknown, never zero.

## Not covered

- **Redis and ClickHouse.** Redis's numbered databases share one password: there is nothing
  to isolate. ClickHouse has no wired admin credential on our containers.
- **Moving a live database between servers.** See the manifest section: it needs a real
  data-copy flow, not a flag.
- **Per-database public exposure.** Needs a proxy that can route by database, not by hostname.
