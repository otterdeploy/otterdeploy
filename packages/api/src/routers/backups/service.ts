/**
 * Backups service — thin org-scoped orchestration over `queries.ts`. Read
 * handlers that can miss return `Result<T, E>` with a typed error the router
 * maps to an HTTP code; pure list handlers return arrays directly (mirrors the
 * env router split).
 */
import type { BackupDestinationId, BackupId, ProjectId } from "@otterdeploy/shared/id";

import { Result } from "better-result";

import type { OrgRef } from "../scopes";

import { decryptSecret, encryptSecret } from "../../lib/crypto";
import {
  BackupNotFoundError,
  DestinationInUseError,
  DestinationNotFoundError,
  DestinationTestFailedError,
} from "./errors";
import {
  type BackupRow,
  type DestinationRow,
  type DestinationView,
  type ScheduleRow,
  countDestinationReferences,
  createDestinationRecord,
  deleteDestinationRecord,
  getBackupInOrg,
  getDestinationWithSecret,
  listBackupsByOrg,
  listDestinationsByOrg,
  listSchedulesByOrg,
  resolveDestinationNames,
  updateDestinationRecord,
} from "./queries";

type BackupKind = "database" | "volume" | "stack";
type DestinationType = "s3" | "local" | "sftp";

/** The mutation response shape — destination view plus computed usage. */
export type DestinationResult = DestinationView & { usedBytes: number };

export async function listBackups(
  input: OrgRef & {
    projectId?: ProjectId;
    kind?: BackupKind;
    destinationId?: BackupDestinationId;
    search?: string;
  },
): Promise<BackupRow[]> {
  return listBackupsByOrg(input);
}

export async function getBackup(
  input: OrgRef & { id: BackupId },
): Promise<Result<BackupRow, BackupNotFoundError>> {
  const row = await getBackupInOrg({
    backupId: input.id,
    organizationId: input.organizationId,
  });
  if (!row) return Result.err(new BackupNotFoundError({ backupId: input.id }));
  return Result.ok(row);
}

export async function listSchedules(input: OrgRef): Promise<ScheduleRow[]> {
  return listSchedulesByOrg(input.organizationId);
}

/** Resolve a schedule's destination ids → names for the presenter. */
export async function scheduleDestinationNames(
  input: OrgRef & { ids: BackupDestinationId[] },
): Promise<string[]> {
  return resolveDestinationNames({
    organizationId: input.organizationId,
    ids: input.ids,
  });
}

export async function listDestinations(input: OrgRef): Promise<DestinationRow[]> {
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

export async function createDestination(
  input: OrgRef & {
    name: string;
    type: DestinationType;
    config: Record<string, unknown>;
    secret?: Record<string, string>;
  },
): Promise<DestinationResult> {
  const encryptedSecret = await encryptDestinationSecret(input.secret);
  const row = await createDestinationRecord({
    organizationId: input.organizationId,
    name: input.name,
    type: input.type,
    config: input.config,
    encryptedSecret,
  });
  return { ...row, usedBytes: 0 };
}

export async function updateDestination(
  input: OrgRef & {
    id: BackupDestinationId;
    name?: string;
    config?: Record<string, unknown>;
    secret?: Record<string, string>;
  },
): Promise<Result<DestinationResult, DestinationNotFoundError>> {
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
): Promise<Result<{ ok: true }, DestinationNotFoundError | DestinationInUseError>> {
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

// Required non-secret config keys per destination type.
const REQUIRED_CONFIG: Record<DestinationType, string[]> = {
  s3: ["bucket"],
  local: ["path"],
  sftp: ["host"],
};

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

  const missing = REQUIRED_CONFIG[row.type].filter(
    (k) => !row.config || row.config[k] == null || row.config[k] === "",
  );
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
