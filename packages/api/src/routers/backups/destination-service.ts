/**
 * Org-scoped destination orchestration. The destination half of the backups
 * service, split out of `service.ts` to keep that file under the max-lines cap
 * (same split as `queries.ts` / `destination-queries.ts`).
 *
 * The guards here are what make the platform-managed local destination safe to
 * always exist: it cannot be deleted or relocated, only renamed. The two
 * boolean toggles that decide whether a row is written to at all live in
 * `destination-flags.ts`. See ../../backups/managed-destination.ts for why the
 * managed row exists.
 */
import type { BackupDestinationId } from "@otterdeploy/shared/id";
import type { JsonObject } from "@otterdeploy/shared/json";

import { Result } from "better-result";

import type { OrgRef } from "../scopes";
import type { DestinationResult } from "./service";

import { ensureManagedLocalDestination } from "../../backups/managed-destination";
import { encryptSecret } from "../../lib/crypto";
import { missingConfigKeys, missingSecret } from "./destination-config";
import { decryptDestinationSecret, probeDestination } from "./destination-probe";
import {
  DestinationConfigInvalidError,
  DestinationInUseError,
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
  updateDestinationRecord,
} from "./queries";

type DestinationType = "s3" | "local" | "sftp" | "azblob" | "gcs";

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

// Secret creds are JSON-serialized then AES-GCM encrypted at rest (registry
// crypto). Empty/undefined → no secret stored (e.g. `local` destinations).
async function encryptDestinationSecret(
  secret: Record<string, string> | undefined,
): Promise<string | null> {
  if (!secret || Object.keys(secret).length === 0) return null;
  return encryptSecret(JSON.stringify(secret));
}

/**
 * Create a destination row.
 *
 * `usedForBackups` is required rather than defaulted because the two callers
 * mean opposite things by it: the Backups → Destinations editor is adding a
 * backup target, while the buckets workbench is storing a bucket to browse.
 * A default here would silently pick one of them.
 */
export async function createDestination(
  input: OrgRef & {
    name: string;
    type: DestinationType;
    config: JsonObject;
    secret?: Record<string, string>;
    usedForBackups: boolean;
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
    usedForBackups: input.usedForBackups,
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
    // volume without space, or (worst) already holding another org's repos.
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
  // The managed row is never deletable. That is the whole point of it: an org
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
 * Live destination test: after the structural checks (required config keys
 * present, secret decrypts), perform a REAL write-read round trip against the
 * backend by initializing (or re-checking) a tiny reserved probe repository
 * with the destination's actual credentials. `init` writes real objects,
 * `check` reads them back, so a green test means "a backup written here can
 * be read back", not merely "the form was filled in".
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

  // `local` needs no secret; every other backend must carry decryptable creds.
  let secret: Record<string, string> = {};
  if (row.type !== "local") {
    const encryptedSecret = row.encryptedSecret;
    if (!encryptedSecret) {
      return Result.err(
        new DestinationTestFailedError({
          destinationId: input.id,
          reason: "No credentials configured",
        }),
      );
    }
    const decrypted = await decryptDestinationSecret(encryptedSecret);
    if (Result.isError(decrypted)) {
      return Result.err(
        new DestinationTestFailedError({
          destinationId: input.id,
          reason: "Stored credential could not be decrypted",
        }),
      );
    }
    secret = decrypted.value;
  }

  const guard = await getDestinationGuardFields({
    organizationId: input.organizationId,
    id: input.id,
  });
  const probed = await probeDestination({
    organizationId: input.organizationId,
    type: row.type,
    config: row.config,
    secret,
    managed: guard?.managed ?? false,
  });
  if (Result.isError(probed)) {
    return Result.err(
      new DestinationTestFailedError({
        destinationId: input.id,
        reason: `Live probe failed: ${probed.error.message.slice(0, 500)}`,
      }),
    );
  }

  return Result.ok({
    message: "Destination verified: wrote a probe repository and read it back.",
  });
}
