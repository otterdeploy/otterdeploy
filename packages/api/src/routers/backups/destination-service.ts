/**
 * Org-scoped destination orchestration — the destination half of the backups
 * service, split out of `service.ts` to keep that file under the max-lines cap
 * (same split as `queries.ts` / `destination-queries.ts`).
 *
 * The guards here are what make the platform-managed local destination safe to
 * always exist: it cannot be deleted or relocated, only renamed or disabled, and
 * disabling is refused while it is the org's last active destination. See
 * ../../backups/managed-destination.ts for why it exists at all.
 */
import type { BackupDestinationId } from "@otterdeploy/shared/id";
import type { JsonObject } from "@otterdeploy/shared/json";

import { Result } from "better-result";

import type { OrgRef } from "../scopes";
import type { DestinationResult } from "./service";

import {
  canDisableManagedDestination,
  ensureManagedLocalDestination,
} from "../../backups/managed-destination";
import { decryptSecret, encryptSecret } from "../../lib/crypto";
import { missingConfigKeys, missingSecret } from "./destination-config";
import {
  DestinationConfigInvalidError,
  DestinationInUseError,
  DestinationLastActiveError,
  DestinationManagedError,
  DestinationNotFoundError,
  DestinationTestFailedError,
} from "./errors";
import {
  type DestinationRow,
  countDestinationReferences,
  createDestinationRecord,
  deleteDestinationRecord,
  getDestinationGuardFields,
  getDestinationWithSecret,
  listDestinationsByOrg,
  setDestinationStatusRecord,
  updateDestinationRecord,
} from "./queries";

type DestinationType = "s3" | "local" | "sftp";

/**
 * List the org's destinations, provisioning the managed local one first.
 *
 * The ensure lives here rather than at org-creation time on purpose: orgs are
 * created by better-auth's organization plugin and there is no after-create hook
 * wired, so a creation-time seed would cover neither the orgs that already exist
 * nor any created through a path we don't own. Ensuring on the read that every
 * backups surface already performs covers all of them with one mechanism and no
 * backfill migration.
 *
 * It does mean a read has an idempotent write side effect. That is deliberate
 * and bounded: one guarded upsert, no-ops on every call after the first.
 */
export async function listDestinations(input: OrgRef): Promise<DestinationRow[]> {
  await ensureManagedLocalDestination(input.organizationId);
  return listDestinationsByOrg(input.organizationId);
}

/**
 * Enable or disable a destination. Disabling is operator intent: the scheduler
 * skips it on future runs while its existing snapshots stay restorable.
 *
 * Guarded so the org can never reach zero active destinations — see
 * `canDisableManagedDestination`. The guard applies to every destination, not
 * just the managed one: disabling the last active S3 bucket is just as silent a
 * failure as disabling the last local one.
 */
export async function setDestinationEnabled(
  input: OrgRef & { id: BackupDestinationId; enabled: boolean },
): Promise<Result<DestinationResult, DestinationNotFoundError | DestinationLastActiveError>> {
  const guard = await getDestinationGuardFields({
    organizationId: input.organizationId,
    id: input.id,
  });
  if (!guard) {
    return Result.err(new DestinationNotFoundError({ destinationId: input.id }));
  }
  if (!input.enabled) {
    const hasPeer = await canDisableManagedDestination({
      organizationId: input.organizationId,
      id: input.id,
    });
    if (!hasPeer) {
      return Result.err(new DestinationLastActiveError({ destinationId: input.id }));
    }
  }
  const row = await setDestinationStatusRecord({
    organizationId: input.organizationId,
    id: input.id,
    status: input.enabled ? "active" : "disabled",
  });
  if (!row) {
    return Result.err(new DestinationNotFoundError({ destinationId: input.id }));
  }
  return Result.ok({ ...row, usedBytes: 0 });
}

// Secret creds are JSON-serialized then AES-GCM encrypted at rest (registry
// crypto). Empty/undefined → no secret stored (e.g. `local` destinations).
async function encryptDestinationSecret(
  secret: Record<string, string> | undefined,
): Promise<string | null> {
  if (!secret || Object.keys(secret).length === 0) return null;
  return encryptSecret(JSON.stringify(secret));
}

export async function createDestination(
  input: OrgRef & {
    name: string;
    type: DestinationType;
    config: JsonObject;
    secret?: Record<string, string>;
  },
): Promise<Result<DestinationResult, DestinationConfigInvalidError>> {
  const missing = missingConfigKeys(input.type, input.config);
  if (missing.length > 0) {
    return Result.err(
      new DestinationConfigInvalidError({
        reason: `missing required config: ${missing.join(", ")}`,
      }),
    );
  }
  if (missingSecret(input.type, input.secret)) {
    return Result.err(new DestinationConfigInvalidError({ reason: "missing credentials" }));
  }
  const encryptedSecret = await encryptDestinationSecret(input.secret);
  const row = await createDestinationRecord({
    organizationId: input.organizationId,
    name: input.name,
    type: input.type,
    config: input.config,
    encryptedSecret,
  });
  return Result.ok({ ...row, usedBytes: 0 });
}

export async function updateDestination(
  input: OrgRef & {
    id: BackupDestinationId;
    name?: string;
    config?: JsonObject;
    secret?: Record<string, string>;
  },
): Promise<
  Result<
    DestinationResult,
    DestinationNotFoundError | DestinationConfigInvalidError | DestinationManagedError
  >
> {
  if (input.config) {
    const existing = await getDestinationWithSecret({
      organizationId: input.organizationId,
      id: input.id,
    });
    if (!existing) {
      return Result.err(new DestinationNotFoundError({ destinationId: input.id }));
    }
    // The managed row's location belongs to the platform. Renaming it is fine
    // (handled below, `config` untouched), but repointing it is not: the path is
    // derived from DATA_ROOT and a user-supplied one could be unwritable, on a
    // volume without space, or — worst — already holding another org's repos.
    const guard = await getDestinationGuardFields({
      organizationId: input.organizationId,
      id: input.id,
    });
    if (guard?.managed) {
      return Result.err(
        new DestinationManagedError({ destinationId: input.id, operation: "reconfigure" }),
      );
    }
    const missing = missingConfigKeys(existing.type, input.config);
    if (missing.length > 0) {
      return Result.err(
        new DestinationConfigInvalidError({
          reason: `missing required config: ${missing.join(", ")}`,
        }),
      );
    }
  }
  const encryptedSecret = await encryptDestinationSecret(input.secret);
  const row = await updateDestinationRecord({
    organizationId: input.organizationId,
    id: input.id,
    name: input.name,
    config: input.config,
    // Only overwrite the secret when a non-empty one was supplied.
    encryptedSecret: encryptedSecret ?? undefined,
  });
  if (!row) {
    return Result.err(new DestinationNotFoundError({ destinationId: input.id }));
  }
  return Result.ok({ ...row, usedBytes: 0 });
}

export async function deleteDestination(
  input: OrgRef & { id: BackupDestinationId },
): Promise<
  Result<{ ok: true }, DestinationNotFoundError | DestinationInUseError | DestinationManagedError>
> {
  // The managed row is never deletable — that is the whole point of it: an org
  // must never be able to reach zero destinations and land back in the
  // "configure a local backup before you can do anything" state. Disable it
  // instead (setDestinationEnabled), which stops new backups without dropping
  // the history.
  const guard = await getDestinationGuardFields({
    organizationId: input.organizationId,
    id: input.id,
  });
  if (!guard) {
    return Result.err(new DestinationNotFoundError({ destinationId: input.id }));
  }
  if (guard.managed) {
    return Result.err(
      new DestinationManagedError({ destinationId: input.id, operation: "delete" }),
    );
  }

  const refs = await countDestinationReferences({
    organizationId: input.organizationId,
    id: input.id,
  });
  if (refs > 0) {
    return Result.err(new DestinationInUseError({ destinationId: input.id, references: refs }));
  }
  const deleted = await deleteDestinationRecord({
    organizationId: input.organizationId,
    id: input.id,
  });
  if (!deleted) {
    return Result.err(new DestinationNotFoundError({ destinationId: input.id }));
  }
  return Result.ok({ ok: true });
}

/**
 * Validates a stored destination credential: required config keys are present
 * and the encrypted secret decrypts cleanly. A failed validation is a typed
 * error (`DestinationTestFailedError`), not a success payload. This is a
 * structural check, not a live connectivity probe — real head-bucket/list
 * lands with the execution engine once an S3 client exists.
 */
export async function testDestination(
  input: OrgRef & { id: BackupDestinationId },
): Promise<Result<{ message: string }, DestinationNotFoundError | DestinationTestFailedError>> {
  const row = await getDestinationWithSecret({
    organizationId: input.organizationId,
    id: input.id,
  });
  if (!row) {
    return Result.err(new DestinationNotFoundError({ destinationId: input.id }));
  }

  const missing = missingConfigKeys(row.type, row.config);
  if (missing.length > 0) {
    return Result.err(
      new DestinationTestFailedError({
        destinationId: input.id,
        reason: `Missing required config: ${missing.join(", ")}`,
      }),
    );
  }

  // `local` needs no secret; s3/sftp must carry decryptable creds.
  if (row.type !== "local") {
    if (!row.encryptedSecret) {
      return Result.err(
        new DestinationTestFailedError({
          destinationId: input.id,
          reason: "No credentials configured",
        }),
      );
    }
    const decrypted = await Result.tryPromise({
      try: () => decryptSecret(row.encryptedSecret as string),
      catch: (cause) => (cause instanceof Error ? cause : new Error("decrypt")),
    });
    if (Result.isError(decrypted)) {
      return Result.err(
        new DestinationTestFailedError({
          destinationId: input.id,
          reason: "Stored credential could not be decrypted",
        }),
      );
    }
  }

  return Result.ok({
    message: "Destination credential is valid (structural check).",
  });
}
