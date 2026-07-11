import type { BackupRow, DestinationRow, ScheduleRow } from "./queries";
/**
 * Row → contract-shape presenters for the backups router. Flatten the joined
 * query rows into the flat schemas the contract outputs.
 */
import type { DestinationResult } from "./service";

/** Flatten an enriched backup row into the contract's `backupSchema`. */
export function presentBackup(row: BackupRow) {
  return {
    ...row.backup,
    source: row.source,
    project: row.project,
    sourceService: row.sourceService,
    sourceHost: row.sourceHost,
    destinationName: row.destinationName,
    destinationType: row.destinationType,
  };
}

export function presentSchedule(row: ScheduleRow) {
  return {
    ...row.schedule,
    destinationNames: row.destinationNames,
    missingSources: row.missingSources,
  };
}

export function presentDestination(row: DestinationRow) {
  return { ...row.destination, usedBytes: row.usedBytes };
}

export function presentDestinationResult(row: DestinationResult) {
  return row;
}
