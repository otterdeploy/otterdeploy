/**
 * SSH key lifecycle. Per-org scoped (filtered on `organization_id`, like the
 * server registry — keys don't transitively belong to a project).
 *
 * Generated keys: `ssh-keygen` produces the pair; we encrypt the private half
 * at rest (`encryptSecret`) and store the public half in the clear. Imported
 * keys hold only the pasted public half (`privateKeyCiphertext = null`).
 */
import type { OrganizationId, SshKeyId } from "@otterdeploy/shared/id";
import { panic, Result } from "better-result";

import { encryptSecret } from "../../lib/crypto";
import { isUniqueViolation } from "../project/views";
import type { OrgRef } from "../scopes";

import {
  SshKeyConflictError,
  SshKeyImportError,
  SshKeyNotFoundError,
  SshKeyNotRotatableError,
} from "./errors";
import {
  generateKeyPair,
  InvalidPublicKeyError,
  parsePublicKey,
  type SshKeyType,
} from "./keygen";
import {
  deleteSshKeyRecord,
  getSshKeyInOrg,
  insertSshKeyRecord,
  listSshKeysByOrg,
  updateSshKeyMaterial,
  type SshKeyRecord,
} from "./queries";

export async function listSshKeys(input: OrgRef): Promise<SshKeyRecord[]> {
  return listSshKeysByOrg(input.organizationId);
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
  const privateKeyCiphertext = await encryptSecret(pair.privateKey);

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

export async function rotateSshKey(
  input: { id: SshKeyId } & OrgRef,
): Promise<
  Result<SshKeyRecord, SshKeyNotFoundError | SshKeyNotRotatableError | SshKeyConflictError>
> {
  const existing = await getSshKeyInOrg({
    id: input.id,
    organizationId: input.organizationId,
  });
  if (!existing) return Result.err(new SshKeyNotFoundError({ id: input.id }));
  if (existing.imported) {
    return Result.err(new SshKeyNotRotatableError({ id: input.id }));
  }

  const pair = await generateKeyPair({
    type: existing.type,
    bits: existing.bits,
    comment: existing.comment ?? existing.name,
    passphrase: null,
  });
  const privateKeyCiphertext = await encryptSecret(pair.privateKey);

  const updated = await Result.tryPromise({
    try: () =>
      updateSshKeyMaterial({
        id: input.id,
        organizationId: input.organizationId,
        type: pair.type,
        bits: pair.bits,
        publicKey: pair.publicKey,
        privateKeyCiphertext,
        fingerprint: pair.fingerprint,
        comment: pair.comment,
      }),
    catch: (cause) =>
      isUniqueViolation(cause)
        ? new SshKeyConflictError({ fingerprint: pair.fingerprint })
        : panic("sshKeys.rotate: unexpected DB error", cause),
  });
  if (Result.isError(updated)) return Result.err(updated.error);
  if (!updated.value) return Result.err(new SshKeyNotFoundError({ id: input.id }));
  return Result.ok(updated.value);
}

export async function deleteSshKey(
  input: { id: SshKeyId } & OrgRef,
): Promise<Result<{ ok: true }, SshKeyNotFoundError>> {
  const deleted = await deleteSshKeyRecord({
    id: input.id,
    organizationId: input.organizationId,
  });
  if (!deleted) return Result.err(new SshKeyNotFoundError({ id: input.id }));
  return Result.ok({ ok: true });
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
