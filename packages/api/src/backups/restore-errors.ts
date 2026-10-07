/**
 * Why a restore did not happen, as values the router can map to a status and
 * a sentence. Before these, every refusal (wrong typed name, cross-engine
 * target, a volume still mounted) and every failure left `restoreBackup` as a
 * plain Error, which oRPC turned into a bare 500 "Internal server error": the
 * restore wizard could not tell the operator what to fix.
 */
import type { BackupRestoreId } from "@otterdeploy/shared/id";

import { TaggedError } from "better-result";

/** The typed-name gate: `confirm` must name what the restore overwrites. */
export class RestoreConfirmationError extends TaggedError("RestoreConfirmationError")<{
  message: string;
  expected: string;
}>() {
  constructor(args: { expected: string }) {
    super({
      expected: args.expected,
      message: `restore confirmation required: type "${args.expected}" to confirm the in-place restore`,
    });
  }
}

/** The requested write target cannot take this snapshot (missing, another
 *  tenant's, another engine, or a database for a volume snapshot). */
export class RestoreTargetInvalidError extends TaggedError("RestoreTargetInvalidError")<{
  message: string;
  reason: string;
}>() {
  constructor(args: { reason: string }) {
    super({ reason: args.reason, message: args.reason });
  }
}

/** The restore is well-formed but the system's current state refuses it:
 *  no stored snapshot, a mounted volume, a stopped target, an engine or
 *  backup kind with no in-place path. Nothing was written. */
export class RestoreRefusedError extends TaggedError("RestoreRefusedError")<{
  message: string;
  reason: string;
}>() {
  constructor(args: { reason: string }) {
    super({ reason: args.reason, message: args.reason });
  }
}

/** Another in-place restore of the same target is running. */
export class RestoreInProgressError extends TaggedError("RestoreInProgressError")<{
  message: string;
  target: string;
}>() {
  constructor(args: { target: string }) {
    super({
      target: args.target,
      message: `another restore into ${args.target} is already running; try again once it finishes`,
    });
  }
}

/** The restore ran and did not complete: its tool exited non-zero, wrote
 *  nothing, or the repository could not be read. `reason` is the tool's own
 *  text (it can carry host paths and daemon errors), so it is recorded on the
 *  failed restore row, which the restore history shows, and only the row id
 *  travels with the wire error. */
export class RestoreFailedError extends TaggedError("RestoreFailedError")<{
  message: string;
  reason: string;
  restoreId: BackupRestoreId;
}>() {
  constructor(args: { reason: string; restoreId: BackupRestoreId }) {
    super({ ...args, message: `restore failed: ${args.reason}` });
  }
}

export type RestoreError =
  | RestoreConfirmationError
  | RestoreTargetInvalidError
  | RestoreRefusedError
  | RestoreInProgressError
  | RestoreFailedError;
