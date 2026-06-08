import type {
  BackupDestinationId,
  BackupId,
} from "@otterdeploy/shared/id";
import { TaggedError } from "better-result";

export class BackupNotFoundError extends TaggedError("BackupNotFoundError")<{
  message: string;
  backupId: BackupId;
}>() {
  constructor(args: { backupId: BackupId }) {
    super({
      backupId: args.backupId,
      message: `backup ${args.backupId} not found`,
    });
  }
}

export class DestinationNotFoundError extends TaggedError(
  "DestinationNotFoundError",
)<{
  message: string;
  destinationId: BackupDestinationId;
}>() {
  constructor(args: { destinationId: BackupDestinationId }) {
    super({
      destinationId: args.destinationId,
      message: `backup destination ${args.destinationId} not found`,
    });
  }
}

/** Raised when deleting a destination still referenced by a schedule/backup. */
export class DestinationInUseError extends TaggedError(
  "DestinationInUseError",
)<{
  message: string;
  destinationId: BackupDestinationId;
  references: number;
}>() {
  constructor(args: { destinationId: BackupDestinationId; references: number }) {
    super({
      destinationId: args.destinationId,
      references: args.references,
      message: `backup destination ${args.destinationId} is referenced by ${args.references} schedule(s)/backup(s)`,
    });
  }
}

/**
 * Raised when a destination credential fails validation — missing required
 * config, no credentials, or an undecryptable secret. Carries the reason so
 * the operator/UI sees exactly what was wrong.
 */
export class DestinationTestFailedError extends TaggedError(
  "DestinationTestFailedError",
)<{
  message: string;
  destinationId: BackupDestinationId;
  reason: string;
}>() {
  constructor(args: { destinationId: BackupDestinationId; reason: string }) {
    super({
      destinationId: args.destinationId,
      reason: args.reason,
      message: `backup destination ${args.destinationId} failed validation: ${args.reason}`,
    });
  }
}
