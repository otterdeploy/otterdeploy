/**
 * Secret-provider handlers — CRUD + credential round-trip for the org's
 * external secret managers.
 *
 * Two rules run through all of this:
 *   1. The credential is write-only. It is encrypted the moment it arrives
 *      ("vault-creds" domain) and no view ever carries it — only
 *      `credentialSet: boolean`.
 *   2. A failing provider keeps its row. `test` records status/lastError so
 *      the operator can fix a rotated token without re-entering the config,
 *      and deploys referencing it fail with an actionable VaultResolveError.
 */

import type { VaultProviderConfig } from "@otterdeploy/db/schema";
import type { OrganizationId, VaultProviderId } from "@otterdeploy/shared/id";

import { decryptForDomain, encryptForDomain } from "../../lib/crypto";
import { isUniqueViolation } from "../../lib/pg-error";
import { listSecretNames, testProvider } from "../../lib/vault";
import {
  deleteVaultProvider,
  getVaultProviderInOrg,
  insertVaultProvider,
  patchVaultVerification,
  updateVaultProviderRecord,
  type VaultProviderRecord,
} from "./queries";

export interface VaultProviderView {
  id: VaultProviderId;
  name: string;
  kind: "hashicorp" | "infisical" | "doppler";
  config: VaultProviderConfig;
  credentialSet: boolean;
  status: "unverified" | "connected" | "error";
  lastVerifiedAt: Date | null;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export function toProviderView(row: VaultProviderRecord): VaultProviderView {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    config: row.configJson,
    credentialSet: row.credentialCiphertext.length > 0,
    status: row.status,
    lastVerifiedAt: row.lastVerifiedAt,
    lastError: row.lastError,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Thrown as a discriminant for the router's NAME_TAKEN mapping. */
export class VaultProviderNameTakenError extends Error {
  constructor(name: string) {
    super(`a secret provider named "${name}" already exists in this workspace`);
  }
}

export async function createVaultProviderHandler(input: {
  organizationId: OrganizationId;
  name: string;
  kind: "hashicorp" | "infisical" | "doppler";
  config: VaultProviderConfig;
  credential: string;
}): Promise<VaultProviderView> {
  const credentialCiphertext = await encryptForDomain(input.credential, "vault-creds");
  try {
    const row = await insertVaultProvider({
      organizationId: input.organizationId,
      name: input.name,
      kind: input.kind,
      configJson: input.config,
      credentialCiphertext,
    });
    return toProviderView(row);
  } catch (err) {
    if (isUniqueViolation(err)) throw new VaultProviderNameTakenError(input.name);
    throw err;
  }
}

export async function updateVaultProviderHandler(input: {
  id: VaultProviderId;
  organizationId: OrganizationId;
  name?: string;
  config?: VaultProviderConfig;
  credential?: string;
}): Promise<VaultProviderView | null> {
  const credentialCiphertext =
    input.credential !== undefined
      ? await encryptForDomain(input.credential, "vault-creds")
      : undefined;
  try {
    const row = await updateVaultProviderRecord({
      id: input.id,
      organizationId: input.organizationId,
      name: input.name,
      configJson: input.config,
      credentialCiphertext,
    });
    return row ? toProviderView(row) : null;
  } catch (err) {
    if (isUniqueViolation(err)) throw new VaultProviderNameTakenError(input.name ?? "");
    throw err;
  }
}

export async function removeVaultProviderHandler(input: {
  id: VaultProviderId;
  organizationId: OrganizationId;
}): Promise<boolean> {
  return deleteVaultProvider(input.id, input.organizationId);
}

/**
 * Round-trip the stored credential and record the outcome. Provider failures
 * are the RESULT here ({ ok: false }), not an exception — the row keeps its
 * config either way.
 */
export async function testVaultProviderHandler(input: {
  id: VaultProviderId;
  organizationId: OrganizationId;
}): Promise<{ ok: boolean; error: string | null } | null> {
  const row = await getVaultProviderInOrg(input.id, input.organizationId);
  if (!row) return null;

  try {
    const credential = await decryptForDomain(row.credentialCiphertext, "vault-creds");
    await testProvider({ name: row.name, kind: row.kind, config: row.configJson, credential });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await patchVaultVerification({
      id: input.id,
      organizationId: input.organizationId,
      status: "error",
      lastError: message,
    });
    return { ok: false, error: message };
  }

  await patchVaultVerification({
    id: input.id,
    organizationId: input.organizationId,
    status: "connected",
    lastError: null,
  });
  return { ok: true, error: null };
}

/** Best-effort key listing for the reference picker — `[]` on any provider
 *  failure so a slow/broken provider degrades the picker, never breaks it. */
export async function listVaultSecretNamesHandler(input: {
  id: VaultProviderId;
  organizationId: OrganizationId;
}): Promise<string[] | null> {
  const row = await getVaultProviderInOrg(input.id, input.organizationId);
  if (!row) return null;
  try {
    const credential = await decryptForDomain(row.credentialCiphertext, "vault-creds");
    return await listSecretNames({
      name: row.name,
      kind: row.kind,
      config: row.configJson,
      credential,
    });
  } catch {
    return [];
  }
}
