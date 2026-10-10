/**
 * SSH key lifecycle. Per-org scoped (filtered on `organization_id`, like the
 * server registry: keys don't transitively belong to a project).
 *
 * Generated keys: `ssh-keygen` produces the pair; we encrypt the private half
 * at rest (`encryptForDomain(..., "ssh-keys")`, domain-separated from every
 * other secret category: see packages/api/src/lib/crypto.ts) and store the
 * public half in the clear. Imported keys hold only the pasted public half
 * (`privateKeyCiphertext = null`).
 */
import type { OrganizationId, SshKeyId } from "@otterdeploy/shared/id";

import { panic, Result } from "better-result";

import type { OrgRef } from "../scopes";

import { encryptForDomain } from "../../lib/crypto";
import { isUniqueViolation } from "../project/views";
import {
  SshKeyConflictError,
  SshKeyImportError,
  SshKeyInUseError,
  SshKeyNotFoundError,
} from "./errors";
import { generateKeyPair, InvalidPublicKeyError, parsePublicKey, type SshKeyType } from "./keygen";
import {
  deleteUnusedSshKeyRecord,
  getSshKeyInOrg,
  insertSshKeyRecord,
  listServersUsingSshKeys,
  listSshKeysByOrg,
  type SshKeyRecord,
} from "./queries";
import { toUsage, type SshKeyView } from "./usage";

export async function listSshKeys(input: OrgRef): Promise<SshKeyView[]> {
  const [keys, servers] = await Promise.all([
    listSshKeysByOrg(input.organizationId),
    listServersUsingSshKeys({ organizationId: input.organizationId }),
  ]);
  const byKey = Map.groupBy(servers, (s) => s.sshKeyId);
  return keys.map((k) => ({ ...k, usedBy: (byKey.get(k.id) ?? []).map(toUsage) }));
}

export async function generateSshKey(
  input: {
    name: string;
    type: SshKeyType;
    bits?: number;
    comment?: string;
    passphrase?: string;
  } & OrgRef,
): Promise<Result<SshKeyRecord, SshKeyConflictError>> {
  const pair = await generateKeyPair({
    type: input.type,
    bits: input.bits ?? null,
    comment: input.comment ?? input.name,
    passphrase: input.passphrase ?? null,
  });
  const privateKeyCiphertext = await encryptForDomain(pair.privateKey, "ssh-keys");

  return insertOrConflict({
    organizationId: input.organizationId,
    name: input.name.trim(),
    type: pair.type,
    bits: pair.bits,
    publicKey: pair.publicKey,
    privateKeyCiphertext,
    fingerprint: pair.fingerprint,
    comment: pair.comment,
    imported: false,
  });
}

export async function importSshKey(
  input: { name: string; publicKey: string } & OrgRef,
): Promise<Result<SshKeyRecord, SshKeyConflictError | SshKeyImportError>> {
  const parsed = await Result.tryPromise({
    try: () => parsePublicKey(input.publicKey),
    catch: (cause) =>
      cause instanceof InvalidPublicKeyError
        ? new SshKeyImportError({ message: cause.message })
        : panic("sshKeys.import: ssh-keygen parse failed", cause),
  });
  if (Result.isError(parsed)) return Result.err(parsed.error);

  return insertOrConflict({
    organizationId: input.organizationId,
    name: input.name.trim(),
    type: parsed.value.type,
    bits: parsed.value.bits,
    publicKey: parsed.value.publicKey,
    privateKeyCiphertext: null,
    fingerprint: parsed.value.fingerprint,
    comment: parsed.value.comment,
    imported: true,
  });
}

export async function deleteSshKey(
  input: { id: SshKeyId } & OrgRef,
): Promise<Result<{ ok: true }, SshKeyNotFoundError | SshKeyInUseError>> {
  const deleted = await deleteUnusedSshKeyRecord({
    id: input.id,
    organizationId: input.organizationId,
  });
  if (deleted) return Result.ok({ ok: true });
  const existing = await getSshKeyInOrg({ id: input.id, organizationId: input.organizationId });
  if (!existing) return Result.err(new SshKeyNotFoundError({ id: input.id }));
  const servers = await listServersUsingSshKeys({
    organizationId: input.organizationId,
    sshKeyId: input.id,
  });
  return Result.err(
    new SshKeyInUseError({
      id: input.id,
      servers: servers.map((s) => ({ serverId: s.serverId, name: s.name })),
    }),
  );
}

async function insertOrConflict(values: {
  organizationId: OrganizationId;
  name: string;
  type: SshKeyType;
  bits: number | null;
  publicKey: string;
  privateKeyCiphertext: string | null;
  fingerprint: string;
  comment: string | null;
  imported: boolean;
}): Promise<Result<SshKeyRecord, SshKeyConflictError>> {
  const insert = await Result.tryPromise({
    try: () => insertSshKeyRecord(values),
    catch: (cause) =>
      isUniqueViolation(cause)
        ? new SshKeyConflictError({ fingerprint: values.fingerprint })
        : panic("sshKeys.insert: unexpected DB error", cause),
  });
  if (Result.isError(insert)) return Result.err(insert.error);
  if (!insert.value) {
    return Result.err(new SshKeyConflictError({ fingerprint: values.fingerprint }));
  }
  return Result.ok(insert.value);
}
