import { db, eq, and } from "@otterstack/db";
import { server, sshKey } from "@otterstack/db/schema/infrastructure";
import { upsertSecretReference } from "@otterstack/secrets";

import { DomainError } from "./errors";
import { type AuditContext, writeAuditLog } from "./audit-writer";
import { encodeLegacySecret } from "./legacy-secret";

function toISOString(date: Date | null | undefined): string | null {
  return date ? date.toISOString() : null;
}

function formatServer(row: typeof server.$inferSelect) {
  return {
    id: row.id,
    organizationId: row.organizationId,
    name: row.name,
    ipAddress: row.ipAddress,
    port: row.port,
    status: row.status,
    role: row.role,
    sshKeyId: row.sshKeyId ?? null,
    lastSeenAt: toISOString(row.lastSeenAt),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function validateAccess(serverId: string, organizationId: string) {
  const row = await db.query.server.findFirst({
    where: and(eq(server.id, serverId), eq(server.organizationId, organizationId)),
  });
  if (!row) throw new DomainError("NOT_FOUND", "Server not found");
  return row;
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
}) {
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
      actorUserId: params.audit.userId,
    });

    const sshRow = {
      id: crypto.randomUUID(),
      organizationId: params.organizationId,
      name: params.ssh.name,
      publicKey: params.ssh.publicKey,
      privateKeySecretReferenceId: sshSecret.reference.id,
      encryptedPrivateKey: encodeLegacySecret(params.ssh.privateKey),
      fingerprint: params.ssh.fingerprint,
      createdAt: now,
    };

    await db.insert(sshKey).values(sshRow);
    sshKeyId = sshRow.id;
  }

  const row = {
    id: crypto.randomUUID(),
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
    throw new DomainError("CONFLICT", "Failed to register server");
  }

  await writeAuditLog(params.organizationId, params.audit, "server.registered", "server", row.id, {
    sshAttached: !!sshKeyId,
  });

  return formatServer(inserted);
}

export async function listServers(organizationId: string) {
  const rows = await db.query.server.findMany({
    where: eq(server.organizationId, organizationId),
  });
  return rows.map(formatServer);
}

export async function testServer(serverId: string, organizationId: string) {
  await validateAccess(serverId, organizationId);
  return {
    serverId,
    status: "offline" as const,
    roundTripMs: null,
  };
}

export async function removeServer(serverId: string, organizationId: string, audit: AuditContext) {
  await validateAccess(serverId, organizationId);
  await db.delete(server).where(eq(server.id, serverId));

  await writeAuditLog(organizationId, audit, "server.removed", "server", serverId, {});

  return { success: true as const };
}
