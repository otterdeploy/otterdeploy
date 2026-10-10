import type { OrganizationId, ServerId, SshKeyId } from "@otterdeploy/shared/id";
import type { InferSelectModel } from "drizzle-orm";

import { db } from "@otterdeploy/db";
import { server } from "@otterdeploy/db/schema/server";
import { sshKey } from "@otterdeploy/db/schema/ssh-key";
import { and, asc, desc, eq, isNotNull, notExists } from "drizzle-orm";

import type { SshKeyType } from "./keygen";

type OrgId = OrganizationId;

export type SshKeyRecord = InferSelectModel<typeof sshKey>;

export async function listSshKeysByOrg(organizationId: OrgId): Promise<SshKeyRecord[]> {
  return db
    .select()
    .from(sshKey)
    .where(eq(sshKey.organizationId, organizationId))
    .orderBy(desc(sshKey.createdAt));
}

export async function getSshKeyInOrg(input: {
  id: SshKeyId;
  organizationId: OrgId;
}): Promise<SshKeyRecord | undefined> {
  const [row] = await db
    .select()
    .from(sshKey)
    .where(and(eq(sshKey.id, input.id), eq(sshKey.organizationId, input.organizationId)))
    .limit(1);
  return row;
}

export async function insertSshKeyRecord(input: {
  organizationId: OrgId;
  name: string;
  type: SshKeyType;
  bits: number | null;
  publicKey: string;
  privateKeyCiphertext: string | null;
  fingerprint: string;
  comment: string | null;
  imported: boolean;
}): Promise<SshKeyRecord | undefined> {
  const [row] = await db.insert(sshKey).values(input).returning();
  return row;
}

/** A server that signs in with a key (`server.ssh_key_id`). */
export interface SshKeyServerRow {
  sshKeyId: SshKeyId;
  serverId: ServerId;
  name: string;
  role: "manager" | "worker";
  host: string;
  sshPort: number;
  sshUser: string;
}

/**
 * Every server in the org that references a key, optionally narrowed to one
 * key. Org-scoped on the server row: a key id from another tenant reports
 * nothing.
 */
export async function listServersUsingSshKeys(input: {
  organizationId: OrgId;
  sshKeyId?: SshKeyId;
}): Promise<SshKeyServerRow[]> {
  const rows = await db
    .select({
      sshKeyId: server.sshKeyId,
      serverId: server.id,
      name: server.name,
      role: server.role,
      host: server.host,
      sshPort: server.sshPort,
      sshUser: server.sshUser,
    })
    .from(server)
    .where(
      and(
        eq(server.organizationId, input.organizationId),
        input.sshKeyId ? eq(server.sshKeyId, input.sshKeyId) : isNotNull(server.sshKeyId),
      ),
    )
    .orderBy(asc(server.name));
  return rows.flatMap((r) => (r.sshKeyId ? [{ ...r, sshKeyId: r.sshKeyId }] : []));
}

/** Replace the key material in place (rotate): keeps id/name, bumps the rest.
 *  `expectedFingerprint` makes it a compare-and-swap: a rotate that raced
 *  another one updates nothing and returns undefined. */
export async function updateSshKeyMaterial(input: {
  id: SshKeyId;
  organizationId: OrgId;
  expectedFingerprint: string;
  type: SshKeyType;
  bits: number | null;
  publicKey: string;
  privateKeyCiphertext: string | null;
  fingerprint: string;
  comment: string | null;
}): Promise<SshKeyRecord | undefined> {
  const [row] = await db
    .update(sshKey)
    .set({
      type: input.type,
      bits: input.bits,
      publicKey: input.publicKey,
      privateKeyCiphertext: input.privateKeyCiphertext,
      fingerprint: input.fingerprint,
      comment: input.comment,
      lastUsedAt: null,
    })
    .where(
      and(
        eq(sshKey.id, input.id),
        eq(sshKey.organizationId, input.organizationId),
        eq(sshKey.fingerprint, input.expectedFingerprint),
      ),
    )
    .returning();
  return row;
}

/**
 * Delete a key only while no server references it, in one statement, so a
 * server attached between a usage check and the delete can't have its
 * `ssh_key_id` nulled by the FK's `on delete set null`. Undefined when the key
 * is missing or in use; the caller tells the two apart.
 */
export async function deleteUnusedSshKeyRecord(input: {
  id: SshKeyId;
  organizationId: OrgId;
}): Promise<{ id: SshKeyId } | undefined> {
  const [deleted] = await db
    .delete(sshKey)
    .where(
      and(
        eq(sshKey.id, input.id),
        eq(sshKey.organizationId, input.organizationId),
        notExists(db.select({ id: server.id }).from(server).where(eq(server.sshKeyId, input.id))),
      ),
    )
    .returning({ id: sshKey.id });
  return deleted;
}
