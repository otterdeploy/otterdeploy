import type { BackupDestinationId, BackupId } from "@otterdeploy/shared/id";

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

export class DestinationNotFoundError extends TaggedError("DestinationNotFoundError")<{
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
export class DestinationInUseError extends TaggedError("DestinationInUseError")<{
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
 * Raised when a mutation targets the platform-managed local destination in a
 * way that isn't allowed: deleting it, or editing the org-scoped repo path the
 * platform owns. Carries `operation` so the UI can explain which door is shut rather
 * than showing a generic refusal: though the UI should not offer these
 * affordances on a managed row in the first place.
 */
export class DestinationManagedError extends TaggedError("DestinationManagedError")<{
  message: string;
  destinationId: BackupDestinationId;
  operation: "delete" | "reconfigure";
}>() {
  constructor(args: { destinationId: BackupDestinationId; operation: "delete" | "reconfigure" }) {
    super({
      destinationId: args.destinationId,
      operation: args.operation,
      message:
        args.operation === "delete"
          ? `backup destination ${args.destinationId} is managed by the platform and cannot be deleted: disable it instead`
          : `backup destination ${args.destinationId} is managed by the platform; its location is not editable`,
    });
  }
}

/**
 * Raised when disabling the managed destination would leave the org with no
 * active destination at all: every schedule would silently become a no-op.
 */
export class DestinationLastActiveError extends TaggedError("DestinationLastActiveError")<{
  message: string;
  destinationId: BackupDestinationId;
}>() {
  constructor(args: { destinationId: BackupDestinationId }) {
    super({
      destinationId: args.destinationId,
      message:
        "this is the only active backup destination: add another one before disabling it, or scheduled backups would stop running",
    });
  }
}

/** Raised on create/update when a destination's config is structurally
 *  incomplete (e.g. a `local` destination with no `path`): rejected up front
 *  so the failure never waits for a backup run to surface. */
export class DestinationConfigInvalidError extends TaggedError("DestinationConfigInvalidError")<{
  message: string;
  reason: string;
}>() {
  constructor(args: { reason: string }) {
    super({
      reason: args.reason,
      message: `backup destination configuration invalid: ${args.reason}`,
    });
  }
}

/**
 * Raised when a destination credential fails validation: missing required
 * config, no credentials, or an undecryptable secret. Carries the reason so
 * the operator/UI sees exactly what was wrong.
 */
export class DestinationTestFailedError extends TaggedError("DestinationTestFailedError")<{
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
