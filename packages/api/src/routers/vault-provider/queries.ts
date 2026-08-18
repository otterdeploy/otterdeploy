/**
 * `vault_provider` persistence: org-scoped external secret-manager rows.
 * Every read is org-filtered so a provider id from another workspace behaves
 * exactly like a missing one.
 */

import type { VaultProviderConfig } from "@otterdeploy/db/schema";
import type { OrganizationId, VaultProviderId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { vaultProvider } from "@otterdeploy/db/schema";
import { omitUndefined } from "@otterdeploy/shared/object";
import { and, asc, eq } from "drizzle-orm";

export type VaultProviderRecord = typeof vaultProvider.$inferSelect;

export async function listVaultProvidersByOrg(
  organizationId: OrganizationId,
): Promise<VaultProviderRecord[]> {
  return db
    .select()
    .from(vaultProvider)
    .where(eq(vaultProvider.organizationId, organizationId))
    .orderBy(asc(vaultProvider.name));
}

export async function getVaultProviderInOrg(
  id: VaultProviderId,
  organizationId: OrganizationId,
): Promise<VaultProviderRecord | null> {
  const [row] = await db
    .select()
    .from(vaultProvider)
    .where(and(eq(vaultProvider.id, id), eq(vaultProvider.organizationId, organizationId)))
    .limit(1);
  return row ?? null;
}

export async function insertVaultProvider(input: {
  organizationId: OrganizationId;
  name: string;
  kind: "hashicorp" | "infisical" | "doppler";
  configJson: VaultProviderConfig;
  credentialCiphertext: string;
}): Promise<VaultProviderRecord> {
  const [row] = await db.insert(vaultProvider).values(input).returning();
  if (!row) throw new Error("vault provider insert returned no row");
  return row;
}

export async function updateVaultProviderRecord(input: {
  id: VaultProviderId;
  organizationId: OrganizationId;
  name?: string;
  configJson?: VaultProviderConfig;
  /** Absent means "keep the stored credential". */
  credentialCiphertext?: string;
}): Promise<VaultProviderRecord | null> {
  const [row] = await db
    .update(vaultProvider)
    .set(
      omitUndefined({
        name: input.name,
        configJson: input.configJson,
        credentialCiphertext: input.credentialCiphertext,
        // Any config/credential change invalidates the last verification -
        // the operator re-tests to earn "connected" back.
        status: "unverified" as const,
        lastError: null,
      }),
    )
    .where(
      and(eq(vaultProvider.id, input.id), eq(vaultProvider.organizationId, input.organizationId)),
    )
    .returning();
  return row ?? null;
}

/** Record a test outcome without touching config or credential. */
export async function patchVaultVerification(input: {
  id: VaultProviderId;
  organizationId: OrganizationId;
  status: "connected" | "error";
  lastError: string | null;
}): Promise<void> {
  await db
    .update(vaultProvider)
    .set({
      status: input.status,
      lastError: input.lastError,
      ...(input.status === "connected" ? { lastVerifiedAt: new Date() } : {}),
    })
    .where(
      and(eq(vaultProvider.id, input.id), eq(vaultProvider.organizationId, input.organizationId)),
    );
}

export async function deleteVaultProvider(
  id: VaultProviderId,
  organizationId: OrganizationId,
): Promise<boolean> {
  const rows = await db
    .delete(vaultProvider)
    .where(and(eq(vaultProvider.id, id), eq(vaultProvider.organizationId, organizationId)))
    .returning({ id: vaultProvider.id });
  return rows.length > 0;
}
