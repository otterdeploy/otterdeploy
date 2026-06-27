import type { OrganizationId, SshKeyId } from "@otterdeploy/shared/id";
import type { InferSelectModel } from "drizzle-orm";

import { db } from "@otterdeploy/db";
import { sshKey } from "@otterdeploy/db/schema/ssh-key";
import { and, desc, eq } from "drizzle-orm";

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

/** Replace the key material in place (rotate) — keeps id/name, bumps the rest. */
export async function updateSshKeyMaterial(input: {
  id: SshKeyId;
  organizationId: OrgId;
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
    .where(and(eq(sshKey.id, input.id), eq(sshKey.organizationId, input.organizationId)))
    .returning();
  return row;
}

export async function deleteSshKeyRecord(input: {
  id: SshKeyId;
  organizationId: OrgId;
}): Promise<{ id: SshKeyId } | undefined> {
  const [deleted] = await db
    .delete(sshKey)
    .where(and(eq(sshKey.id, input.id), eq(sshKey.organizationId, input.organizationId)))
    .returning({ id: sshKey.id });
  return deleted;
}
