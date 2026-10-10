/**
 * Rotating a key servers sign in with: push the new public key over the
 * current key, prove it, swap, then retire the old one. See rotateSshKey.
 */
import type { SshKeyId } from "@otterdeploy/shared/id";

import { panic, Result } from "better-result";

import type { OrgRef } from "../scopes";
import type { GeneratedKeyPair } from "./keygen";
import type { SshKeyServerRow } from "./queries";

import { decryptForDomain, encryptForDomain } from "../../lib/crypto";
import { emitPlatformEvent } from "../../notifications/emit";
import { isUniqueViolation } from "../project/views";
import { addAuthorizedKey, checkSignIn, removeAuthorizedKey } from "./authorized-keys";
import {
  SshKeyChangedError,
  SshKeyConflictError,
  SshKeyNotFoundError,
  SshKeyNotRotatableError,
  SshKeyRotateFailedError,
  type RotateServerResult,
  type RotateStep,
} from "./errors";
import { generateKeyPair } from "./keygen";
import { getSshKeyInOrg, listServersUsingSshKeys, updateSshKeyMaterial } from "./queries";
import { toUsage, type SshKeyView } from "./usage";

export interface RotatedSshKey {
  key: SshKeyView;
  /** One entry per server that signs in with the key; empty for an unused key. */
  servers: RotateServerResult[];
}

/**
 * Replace a generated key's material. For a key servers sign in with, the
 * order is what keeps the control plane able to reach them throughout:
 *
 *   1. on every server, sign in with the CURRENT key and append the new
 *      public key to the sign-in user's authorized_keys;
 *   2. sign in to every server with the NEW key;
 *   3. swap the stored key;
 *   4. remove the old public key from every server, signed in with the new one.
 *
 * Steps 1-2 run on all servers before anything is decided, so one report
 * covers every server that would block. If any server fails either step the
 * rotation stops before the swap: the new public key is removed again
 * wherever it was added, the stored key is untouched, and every server keeps
 * accepting the current key. A failure in step 4 doesn't undo the rotation
 * (the new key already works everywhere); that server reports `old_key_kept`.
 * `ssh.rotated` is emitted only once the swap has happened.
 */
export async function rotateSshKey(
  input: { id: SshKeyId } & OrgRef,
): Promise<
  Result<
    RotatedSshKey,
    | SshKeyNotFoundError
    | SshKeyNotRotatableError
    | SshKeyConflictError
    | SshKeyChangedError
    | SshKeyRotateFailedError
  >
> {
  const existing = await getSshKeyInOrg({
    id: input.id,
    organizationId: input.organizationId,
  });
  if (!existing) return Result.err(new SshKeyNotFoundError({ id: input.id }));
  if (existing.imported || existing.privateKeyCiphertext == null) {
    return Result.err(new SshKeyNotRotatableError({ id: input.id }));
  }

  const servers = await listServersUsingSshKeys({
    organizationId: input.organizationId,
    sshKeyId: input.id,
  });
  const pair = await generateKeyPair({
    type: existing.type,
    bits: existing.bits,
    comment: existing.comment ?? existing.name,
    passphrase: null,
  });
  const oldPrivateKey =
    servers.length > 0 ? await decryptForDomain(existing.privateKeyCiphertext, "ssh-keys") : "";

  // Steps 1-2, on every server at once.
  const attempts = await Promise.all(servers.map((s) => authorizeNewKey(s, oldPrivateKey, pair)));
  if (attempts.some((a) => a.failure)) {
    const results = await rollBack(attempts, oldPrivateKey, existing.publicKey, pair.publicKey);
    return Result.err(new SshKeyRotateFailedError({ id: input.id, servers: results }));
  }

  // Step 3.
  const privateKeyCiphertext = await encryptForDomain(pair.privateKey, "ssh-keys");
  const updated = await Result.tryPromise({
    try: () =>
      updateSshKeyMaterial({
        id: input.id,
        organizationId: input.organizationId,
        expectedFingerprint: existing.fingerprint,
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
  if (Result.isError(updated) || !updated.value) {
    // Nothing was swapped: put every server back the way it was.
    await rollBack(attempts, oldPrivateKey, existing.publicKey, pair.publicKey);
    if (Result.isError(updated)) return Result.err(updated.error);
    const still = await getSshKeyInOrg({ id: input.id, organizationId: input.organizationId });
    return Result.err(
      still ? new SshKeyChangedError({ id: input.id }) : new SshKeyNotFoundError({ id: input.id }),
    );
  }
  const record = updated.value;

  // Step 4.
  const results = await Promise.all(
    servers.map(async (s): Promise<RotateServerResult> => {
      const removed = await removeAuthorizedKey(
        hostOf(s),
        pair.privateKey,
        existing.publicKey,
        pair.publicKey,
      );
      return Result.isError(removed)
        ? serverResult(s, "old_key_kept", "cleanup", removed.error.message)
        : serverResult(s, "reauthorized", null, null);
    }),
  );

  // Best-effort: notify subscribed channels the key was rotated. emitPlatformEvent
  // never throws, so it can't fail the rotation.
  await emitPlatformEvent({
    organizationId: input.organizationId,
    eventId: "ssh.rotated",
    title: "SSH key rotated",
    message:
      servers.length > 0
        ? `${record.name}. New fingerprint ${record.fingerprint}, re-authorized on ${servers.length} server${servers.length === 1 ? "" : "s"}`
        : `${record.name}. New fingerprint ${record.fingerprint}`,
    data: {
      sshKeyId: input.id,
      name: record.name,
      fingerprint: record.fingerprint,
    },
  });
  return Result.ok({ key: { ...record, usedBy: servers.map(toUsage) }, servers: results });
}

interface Attempt {
  server: SshKeyServerRow;
  /** Signed in with the current key, so the new key may have been added and
   *  rollback has to remove it. */
  touched: boolean;
  failure: { step: RotateStep; error: string } | null;
}

const hostOf = (s: SshKeyServerRow) => ({ host: s.host, port: s.sshPort, user: s.sshUser });

function serverResult(
  s: SshKeyServerRow,
  outcome: RotateServerResult["outcome"],
  step: RotateStep | null,
  error: string | null,
): RotateServerResult {
  return { serverId: s.serverId, name: s.name, outcome, step, error };
}

async function authorizeNewKey(
  server: SshKeyServerRow,
  oldPrivateKey: string,
  pair: GeneratedKeyPair,
): Promise<Attempt> {
  const added = await addAuthorizedKey(hostOf(server), oldPrivateKey, pair.publicKey);
  if (Result.isError(added)) {
    const step = added.error.stage === "connect" ? "connect" : "add";
    return {
      server,
      touched: step === "add",
      failure: { step, error: added.error.message },
    };
  }
  const signedIn = await checkSignIn(hostOf(server), pair.privateKey);
  if (Result.isError(signedIn)) {
    return { server, touched: true, failure: { step: "verify", error: signedIn.error.message } };
  }
  return { server, touched: true, failure: null };
}

/** Remove the new public key everywhere it may have been added, keeping the
 *  current one. Reports one result per server. */
async function rollBack(
  attempts: Attempt[],
  oldPrivateKey: string,
  oldPublicKey: string,
  newPublicKey: string,
): Promise<RotateServerResult[]> {
  return Promise.all(
    attempts.map(async (a): Promise<RotateServerResult> => {
      const undo = a.touched
        ? await removeAuthorizedKey(hostOf(a.server), oldPrivateKey, newPublicKey, oldPublicKey)
        : Result.ok(undefined);
      if (a.failure) {
        // The failure is the headline; a failed undo on the same server is
        // still worth knowing, so it rides along in the message.
        const undoNote = Result.isError(undo)
          ? ` (removing the new key again also failed: ${undo.error.message})`
          : "";
        return serverResult(a.server, "failed", a.failure.step, a.failure.error + undoNote);
      }
      return Result.isError(undo)
        ? serverResult(a.server, "rollback_failed", "cleanup", undo.error.message)
        : serverResult(a.server, "rolled_back", null, null);
    }),
  );
}
