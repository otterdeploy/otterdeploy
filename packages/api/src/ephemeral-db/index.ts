/**
 * Ephemeral database credentials — short-lived connection URLs you can hand to
 * an agent (or a teammate, or a script) and forget. Each one is a REAL
 * Postgres role minted in the target database:
 *
 *   - `VALID UNTIL <expiry>` makes Postgres itself refuse new logins after the
 *     TTL — disposal doesn't depend on the control plane being alive.
 *   - The sweeper (startEphemeralDbSweeper, 60s tick) finishes the job:
 *     terminates lingering sessions, drops the role, and stamps `revokedAt`.
 *   - `read-only` grants pg_read_all_data (PG14+): SELECT on everything,
 *     current and future. `read-write` grants membership in the owning app
 *     role, so the credential can do whatever the app user can.
 *   - The password is never stored; the URL is returned exactly once at mint.
 *
 * SQL runs through the same docker-exec psql transport as the data viewer
 * (backups/exec) — no wire driver in the control plane. Postgres only for v1.
 */
import type {
  DatabaseEphemeralCredentialId,
  OrganizationId,
  ResourceId,
} from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { databaseEphemeralCredential, type EphemeralDbScope } from "@otterdeploy/db/schema";
import { and, eq } from "drizzle-orm";
import { randomBytes } from "node:crypto";

import { getEngineAdapter } from "../swarm";
import {
  dropRole,
  EphemeralDbError,
  getTarget,
  literal,
  quoteIdent,
  runAsOwner,
} from "./internals";

export { EphemeralDbError } from "./internals";
export { startEphemeralDbSweeper, sweepExpiredEphemeralCredentials } from "./sweeper";

const ROLE_PREFIX = "otter_eph_";

// ── mint ─────────────────────────────────────────────────────────────────────

export interface MintedCredential {
  id: DatabaseEphemeralCredentialId;
  roleName: string;
  scope: EphemeralDbScope;
  expiresAt: Date;
  /** Reachable from other services on the project network. */
  internalUrl: string;
  /** Reachable from anywhere — null unless public access is enabled. */
  publicUrl: string | null;
}

export async function mintEphemeralCredential(input: {
  organizationId: OrganizationId;
  resourceId: ResourceId;
  ttlMinutes: number;
  scope: EphemeralDbScope;
  label?: string;
  createdByUserId?: string;
}): Promise<MintedCredential> {
  const target = await getTarget(input);
  if (!target) throw new EphemeralDbError("database not found");
  if (target.engine !== "postgres") {
    throw new EphemeralDbError(
      `ephemeral credentials are postgres-only for now (got ${target.engine})`,
    );
  }

  const roleName = `${ROLE_PREFIX}${randomBytes(6).toString("hex")}`;
  const password = randomBytes(18).toString("base64url");
  const expiresAt = new Date(Date.now() + input.ttlMinutes * 60_000);

  // One transaction: role + connect + scope grant. VALID UNTIL is the
  // database-native backstop — new logins die at expiry with no help from us.
  const grant =
    input.scope === "read-write"
      ? // Membership in the owning app role: ownership rights over every object
        // the app created (and creates later), but no role attributes — LOGIN/
        // SUPERUSER etc. are never inherited.
        `GRANT ${quoteIdent(target.ownerUsername)} TO ${quoteIdent(roleName)};`
      : // SELECT on everything, current and future (PG14+ predefined role).
        `GRANT pg_read_all_data TO ${quoteIdent(roleName)};`;
  await runAsOwner(
    target,
    [
      `CREATE ROLE ${quoteIdent(roleName)} WITH LOGIN PASSWORD ${literal(password)} VALID UNTIL ${literal(expiresAt.toISOString())} CONNECTION LIMIT 10;`,
      `GRANT CONNECT ON DATABASE ${quoteIdent(target.databaseName)} TO ${quoteIdent(roleName)};`,
      grant,
    ].join("\n"),
  );

  const [row] = await db
    .insert(databaseEphemeralCredential)
    .values({
      resourceId: input.resourceId,
      roleName,
      scope: input.scope,
      label: input.label ?? null,
      expiresAt,
      createdByUserId: input.createdByUserId ?? null,
    })
    .returning({ id: databaseEphemeralCredential.id });
  if (!row) throw new EphemeralDbError("failed to record the credential");

  const adapter = getEngineAdapter("postgres");
  return {
    id: row.id,
    roleName,
    scope: input.scope,
    expiresAt,
    internalUrl: adapter.buildConnectionString({
      username: roleName,
      password,
      host: target.internalHostname,
      port: target.internalPort,
      databaseName: target.databaseName,
    }),
    // Same shape as the resource's own public URL: through Caddy layer-4 on
    // 443 (implicit), TLS required. See routers/project/views.ts.
    publicUrl: target.publicEnabled
      ? adapter.buildConnectionString({
          username: roleName,
          password,
          host: target.publicHostname,
          databaseName: target.databaseName,
          sslmode: "require",
          sslnegotiation: "direct",
        })
      : null,
  };
}

// ── revoke ───────────────────────────────────────────────────────────────────

export async function revokeEphemeralCredential(input: {
  organizationId: OrganizationId;
  resourceId: ResourceId;
  credentialId: DatabaseEphemeralCredentialId;
}): Promise<boolean> {
  const [cred] = await db
    .select()
    .from(databaseEphemeralCredential)
    .where(
      and(
        eq(databaseEphemeralCredential.id, input.credentialId),
        eq(databaseEphemeralCredential.resourceId, input.resourceId),
      ),
    )
    .limit(1);
  if (!cred) throw new EphemeralDbError("credential not found");
  if (cred.revokedAt) return false;

  const target = await getTarget(input);
  if (!target) throw new EphemeralDbError("database not found");

  await dropRole(target, cred.roleName);
  await db
    .update(databaseEphemeralCredential)
    .set({ revokedAt: new Date() })
    .where(eq(databaseEphemeralCredential.id, cred.id));
  return true;
}
