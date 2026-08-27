/**
 * Shared database servers: several logical databases inside one engine
 * container, each with its own database, login role and credentials.
 *
 * The reason this exists: a dozen low-traffic services should not mean a dozen
 * Postgres processes, each holding its own shared_buffers on the same box. A
 * tenant costs a `CREATE DATABASE` and a role.
 *
 * What a tenant is NOT: it has no container, no volume and no placement of its
 * own, so it cannot be restarted, pinned or ZFS-branched independently of its
 * host. Everything else — connection strings, `${{name.DATABASE_URL}}` refs,
 * backups, the data viewer, ephemeral credentials — behaves exactly as it does
 * for a dedicated database, because the row is the same row.
 */
import type { DatabaseEngine } from "@otterdeploy/shared/database-engines";
import type { OrganizationId, ResourceId } from "@otterdeploy/shared/id";
import type { RequestLogger } from "evlog";

import type { ConnectionUsage, TenantIdentity } from "../swarm/database-engines/tenancy";
import type { HostRow } from "./internals";

import { engineSupportsHosting, getTenancy } from "../swarm/database-engines/tenancy";
import { DatabaseHostingError, getHostRow, runAdminStatement } from "./internals";

export { DatabaseHostingError, getHostRow, listTenantRows } from "./internals";
export type { HostRow } from "./internals";

/**
 * Resolve a host and prove it can take a tenant of `engine`, before anything
 * is written down. Every failure here is a refusal the operator sees at create
 * time rather than a half-provisioned row.
 */
export async function resolveHostForTenant(input: {
  organizationId: OrganizationId;
  hostResourceId: ResourceId;
  engine: DatabaseEngine;
}): Promise<HostRow> {
  const host = await getHostRow({
    organizationId: input.organizationId,
    resourceId: input.hostResourceId,
  });
  if (!host) {
    throw new DatabaseHostingError("host_not_found", "database server not found");
  }
  // One level only. Allowing a tenant to host tenants would mean carving a
  // database out of a role that isn't a superuser, which fails halfway
  // through the plan rather than up front.
  if (host.hostResourceId) {
    throw new DatabaseHostingError(
      "host_is_tenant",
      `"${host.name}" is itself hosted on another server, so it can't host databases`,
    );
  }
  if (!engineSupportsHosting(host.engine)) {
    throw new DatabaseHostingError(
      "engine_unsupported",
      `${host.engine} can't host isolated databases`,
    );
  }
  // The wire protocol, the client library and the connection string are all
  // per-engine: a postgres database cannot live inside a mariadb server.
  if (host.engine !== input.engine) {
    throw new DatabaseHostingError(
      "engine_mismatch",
      `server "${host.name}" runs ${host.engine}, not ${input.engine}`,
    );
  }
  return host;
}

/**
 * Carve the tenant out of the host: database, login role, isolation grants and
 * connection cap. Idempotent — a retried apply converges on the declared
 * password instead of failing on a duplicate.
 */
export async function provisionTenant(
  input: { host: HostRow; tenant: TenantIdentity },
  log?: RequestLogger,
): Promise<void> {
  const tenancy = getTenancy(input.host.engine);
  if (!tenancy) {
    throw new DatabaseHostingError(
      "engine_unsupported",
      `${input.host.engine} can't host isolated databases`,
    );
  }
  const statements = tenancy.createStatements(input.tenant, input.host.admin);
  for (const statement of statements) {
    await runAdminStatement(input.host, statement);
  }
  log?.set({
    hosting: {
      action: "provision",
      host: input.host.name,
      database: input.tenant.databaseName,
      statements: statements.length,
    },
  });
}

/**
 * Drop the tenant's database and role. Idempotent, because a delete that
 * half-succeeded has to be retryable: the row is the source of truth and is
 * removed either way, so anything left behind here would be invisible.
 */
export async function dropTenant(
  input: { host: HostRow; tenant: TenantIdentity },
  log?: RequestLogger,
): Promise<void> {
  const tenancy = getTenancy(input.host.engine);
  if (!tenancy) return;
  for (const statement of tenancy.dropStatements(input.tenant, input.host.admin)) {
    await runAdminStatement(input.host, statement);
  }
  log?.set({
    hosting: { action: "drop", host: input.host.name, database: input.tenant.databaseName },
  });
}

/**
 * How much of the server's connection budget is in use. This is the number
 * that decides whether another tenant is a good idea: postgres ships with
 * `max_connections = 100`, and ten services with pools of ten is the whole
 * server. Null when the engine's client printed something we won't guess at.
 */
export async function hostConnectionUsage(host: HostRow): Promise<ConnectionUsage | null> {
  const tenancy = getTenancy(host.engine);
  if (!tenancy) return null;
  const stdout = await runAdminStatement(host, { sql: tenancy.usageStatement() });
  return tenancy.parseUsage(stdout);
}
