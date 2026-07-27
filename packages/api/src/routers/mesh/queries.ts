/**
 * `mesh_network` persistence — one row per org, upserted by the connect flow.
 * Design: docs/designs/vpn-mesh.md
 */

import type { OrganizationId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { meshNetwork } from "@otterdeploy/db/schema";
import { eq } from "drizzle-orm";

export type MeshNetworkRecord = typeof meshNetwork.$inferSelect;

export async function getMeshNetwork(
  organizationId: OrganizationId,
): Promise<MeshNetworkRecord | null> {
  const [row] = await db
    .select()
    .from(meshNetwork)
    .where(eq(meshNetwork.organizationId, organizationId))
    .limit(1);
  return row ?? null;
}

/**
 * The row only when it's actually usable. Callers on the data path (private
 * exposure, key minting) must use this rather than `getMeshNetwork` so a
 * disconnected or erroring mesh can never be treated as live.
 */
export async function getConnectedMeshNetwork(
  organizationId: OrganizationId,
): Promise<MeshNetworkRecord | null> {
  const row = await getMeshNetwork(organizationId);
  return row?.status === "connected" ? row : null;
}

export interface UpsertMeshNetworkInput {
  organizationId: OrganizationId;
  provider: "netbird" | "tailscale";
  managementUrl: string;
  apiTokenCiphertext: string;
  oauthClientId?: string | null;
  accountId: string | null;
  peerDomain: string | null;
  dnsLabel: string;
  nodeGroupId: string | null;
}

/** Connect (or re-connect) — one mesh per org, so this upserts on the org. */
export async function upsertMeshNetwork(input: UpsertMeshNetworkInput): Promise<MeshNetworkRecord> {
  const values = {
    organizationId: input.organizationId,
    provider: input.provider,
    managementUrl: input.managementUrl,
    apiTokenCiphertext: input.apiTokenCiphertext,
    oauthClientId: input.oauthClientId ?? null,
    accountId: input.accountId,
    peerDomain: input.peerDomain,
    dnsLabel: input.dnsLabel,
    nodeGroupId: input.nodeGroupId,
    status: "connected" as const,
    lastVerifiedAt: new Date(),
    lastError: null,
  };
  const [row] = await db
    .insert(meshNetwork)
    .values(values)
    .onConflictDoUpdate({ target: meshNetwork.organizationId, set: values })
    .returning();
  return row!;
}

/** Record the outcome of a re-verify without touching the credential. */
export async function patchMeshVerification(input: {
  organizationId: OrganizationId;
  status: "connected" | "error";
  lastError: string | null;
  peerDomain?: string | null;
  accountId?: string | null;
}): Promise<void> {
  await db
    .update(meshNetwork)
    .set({
      status: input.status,
      lastError: input.lastError,
      lastVerifiedAt: input.status === "connected" ? new Date() : undefined,
      ...(input.peerDomain != null ? { peerDomain: input.peerDomain } : {}),
      ...(input.accountId != null ? { accountId: input.accountId } : {}),
    })
    .where(eq(meshNetwork.organizationId, input.organizationId));
}

export async function setMeshAccessGroups(input: {
  organizationId: OrganizationId;
  accessGroupIds: string[];
}): Promise<void> {
  await db
    .update(meshNetwork)
    .set({ accessGroupIds: input.accessGroupIds })
    .where(eq(meshNetwork.organizationId, input.organizationId));
}

/**
 * Disconnect. Deliberately a status flip, not a delete: existing peers keep
 * running, and any route still marked private must be reported as drift
 * rather than silently re-exposed to the internet. The credential IS cleared
 * — there's no reason to keep an API token we've been told to stop using.
 */
export async function disconnectMeshNetwork(organizationId: OrganizationId): Promise<void> {
  await db
    .update(meshNetwork)
    .set({
      status: "disconnected",
      apiTokenCiphertext: "",
      lastError: null,
    })
    .where(eq(meshNetwork.organizationId, organizationId));
}
