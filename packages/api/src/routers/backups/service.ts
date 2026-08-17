/**
 * Backups service: thin org-scoped orchestration over `queries.ts`. Read
 * handlers that can miss return `Result<T, E>` with a typed error the router
 * maps to an HTTP code; pure list handlers return arrays directly (mirrors the
 * env router split).
 */
import type { BackupDestinationId, BackupId, ProjectId } from "@otterdeploy/shared/id";

import { Result } from "better-result";

import type { OrgRef } from "../scopes";

import { BackupNotFoundError } from "./errors";
import {
  type BackupRow,
  type DestinationView,
  type ScheduleRow,
  getBackupInOrg,
  listBackupsByOrg,
  listSchedulesByOrg,
  resolveDestinationNames,
} from "./queries";

type BackupKind = "database" | "volume";

/** The mutation response shape: destination view plus computed usage. */
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

// Destination orchestration lives in a sibling module (mirrors the
// queries.ts / destination-queries.ts split); re-exported here so the router's
// `./service` import surface stays a single entry point.
export {
  createDestination,
  deleteDestination,
  listDestinations,
  setDestinationEnabled,
  testDestination,
  updateDestination,
} from "./destination-service";
