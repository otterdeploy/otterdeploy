import { Result } from "better-result";
import { db, eq, and } from "@otterdeploy/db";
import { server, sshKey } from "@otterdeploy/db/schema/infrastructure";
import { upsertSecretReference } from "@otterdeploy/secrets";

import { createId } from "@otterdeploy/utils";

import { NotFoundError, ConflictError } from "./errors";
import { type AuditContext, writeAuditLog } from "./audit-writer";

function toISOString(date: Date | null | undefined): string | null {
  return date ? date.toISOString() : null;
}

function formatServer(row: typeof server.$inferSelect) {
  return {
    ...row,
    lastSeenAt: toISOString(row.lastSeenAt),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function validateAccess(
  serverId: string,
  organizationId: string,
): Promise<Result<typeof server.$inferSelect, NotFoundError>> {
  const row = await db.query.server.findFirst({
    where: and(eq(server.id, serverId), eq(server.organizationId, organizationId)),
  });
  if (!row) return Result.err(new NotFoundError({ resource: "server", id: serverId }));
  return Result.ok(row);
}

export async function registerServer(params: {
  organizationId: string;
  name: string;
  ipAddress: string;
  port: number;
  role: "manager" | "worker";
  ssh?: {
    name: string;
    publicKey: string;
    privateKey: string;
    fingerprint: string;
  };
  audit: AuditContext;
}): Promise<Result<ReturnType<typeof formatServer>, ConflictError>> {
  const now = new Date();
  let sshKeyId: string | null = null;

  if (params.ssh) {
    const sshSecret = await upsertSecretReference({
      organizationId: params.organizationId,
      kind: "ssh_private_key",
      logicalScope: "organization",
      logicalScopeId: params.organizationId,
      key: `server.${params.ipAddress}.${params.port}.ssh_private_key`,
      plaintext: params.ssh.privateKey,
      actorUserId: params.audit.userId ?? "system",
    });

    const sshRow = {
      id: createId(),
      organizationId: params.organizationId,
      name: params.ssh.name,
      publicKey: params.ssh.publicKey,
      privateKeySecretReferenceId: sshSecret.reference.id,
      fingerprint: params.ssh.fingerprint,
      createdAt: now,
    };

    await db.insert(sshKey).values(sshRow);
    sshKeyId = sshRow.id;
  }

  const row = {
    id: createId(),
    organizationId: params.organizationId,
    name: params.name,
    ipAddress: params.ipAddress,
    port: params.port,
    sshKeyId,
    status: "disconnected" as const,
    role: params.role,
    lastSeenAt: null,
    metadata: {},
    createdAt: now,
    updatedAt: now,
  };

  const [inserted] = await db.insert(server).values(row).returning();
  if (!inserted) {
    return Result.err(
      new ConflictError({ resource: "server", detail: "Failed to register server" }),
    );
  }

  await writeAuditLog(params.organizationId, params.audit, "server.registered", "server", row.id, {
    sshAttached: !!sshKeyId,
  });

  return Result.ok(formatServer(inserted));
}

export async function listServers(organizationId: string) {
  const rows = await db.query.server.findMany({
    where: eq(server.organizationId, organizationId),
  });
  return rows.map(formatServer);
}

export async function testServer(
  serverId: string,
  organizationId: string,
): Promise<
  Result<
    { serverId: string; status: "healthy" | "degraded" | "offline"; roundTripMs: number | null },
    NotFoundError
  >
> {
  const result = await validateAccess(serverId, organizationId);
  if (result.isErr()) return result;
  return Result.ok({
    serverId,
    status: "offline" as const,
    roundTripMs: null,
  });
}

export async function removeServer(
  serverId: string,
  organizationId: string,
  audit: AuditContext,
): Promise<Result<{ success: true }, NotFoundError>> {
  const result = await validateAccess(serverId, organizationId);
  if (result.isErr()) return result;

  await db.delete(server).where(eq(server.id, serverId));

  await writeAuditLog(organizationId, audit, "server.removed", "server", serverId, {});

  return Result.ok({ success: true as const });
}
