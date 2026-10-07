/**
 * Restore for rustic snapshots. `restoreBackup` hands back the snapshot
 * file bytes (download) or streams them into the live database/volume (in-place,
 * typed-name-confirmed; verify-snapshot.ts holds the structural check). rustic owns dedup + zstd +
 * repo-key encryption, so there is no decrypt/gunzip/checksum plumbing here. A
 * run's `storagePath` is the snapshot id, which is all we need to address it.
 * Split out of engine.ts, which keeps the backup write path (executeBackup).
 */
import type { BackupId, ResourceId } from "@otterdeploy/shared/id";
import type { Writable } from "node:stream";

import { Docker } from "@otterdeploy/docker";
import { errorFromUnknown } from "@otterdeploy/shared/promise";
import { Result } from "better-result";
import { Writable as NodeWritable } from "node:stream";

import type { ResolvedDestination } from "./backends";

import { deriveRepoKey, repoScope, toRusticRepo } from "./backends";
import {
  type DatabaseTarget,
  type ExecutionContext,
  getExecutionContext,
  resolveDatabaseTarget,
} from "./db";
import { resolveSecret } from "./engine-helpers";
import {
  claimRestoreLock,
  createRestoreRun,
  finishRestoreRun,
  releaseRestoreLock,
} from "./restore-db";
import {
  RestoreConfirmationError,
  type RestoreError,
  RestoreFailedError,
  RestoreInProgressError,
  RestoreRefusedError,
  RestoreTargetInvalidError,
} from "./restore-errors";
import { restoreDatabaseInPlace, restoreVolumeInPlace } from "./restore-in-place";
import { RusticCli } from "./rustic";

/** Open the run's rustic repo: resolve backend creds, derive the (resource ×
 *  destination) repo key + its password, and build a driver. */
export async function openRepo(ctx: ExecutionContext): Promise<RusticCli> {
  const secret = await resolveSecret(ctx);
  const dest: ResolvedDestination = {
    type: ctx.destination.type,
    config: ctx.destination.config,
    secret,
  };
  return new RusticCli(toRusticRepo(dest, deriveRepoKey(ctx)));
}

/** A buffer-collecting Writable + a promise that resolves with the bytes once
 *  the writer finishes: the sink we hand `dumpToStream` when a caller needs the
 *  snapshot file materialised (download bytes, or the volume tar to re-extract). */
function bufferSink(): { sink: Writable; done: Promise<Buffer> } {
  const chunks: Buffer[] = [];
  let resolveDone!: (b: Buffer) => void;
  let rejectDone!: (e: Error) => void;
  const done = new Promise<Buffer>((res, rej) => {
    resolveDone = res;
    rejectDone = rej;
  });
  const sink = new NodeWritable({
    write(chunk: Buffer, _enc, cb) {
      chunks.push(chunk);
      cb();
    },
    final(cb) {
      resolveDone(Buffer.concat(chunks));
      cb();
    },
  });
  sink.on("error", rejectDone);
  return { sink, done };
}

export type RestoreMode = "download" | "in-place";

/** What a restore hands back: `download` carries the snapshot file's bytes. */
export interface RestoreOutput {
  ok: true;
  bytes?: Buffer;
  filename?: string;
}

/**
 * The database a restore should WRITE to, or null to write back over the
 * snapshot's own source.
 *
 * Scoped to the run's organization: the snapshot is already tied to the caller's
 * org upstream, but the write target is a separate id and must be re-checked, or
 * a caller could restore their own snapshot into another tenant's database.
 */
async function resolveRestoreTarget(
  ctx: ExecutionContext,
  targetResourceId: ResourceId | undefined,
): Promise<Result<DatabaseTarget | null, RestoreTargetInvalidError>> {
  if (!targetResourceId) return Result.ok(null);
  if (ctx.kind === "volume") {
    return Result.err(
      new RestoreTargetInvalidError({
        reason: "a volume snapshot cannot be restored into a database",
      }),
    );
  }
  if (targetResourceId === ctx.resourceId) return Result.ok(null);
  const target = await resolveDatabaseTarget(targetResourceId, ctx.organizationId);
  if (!target) {
    return Result.err(
      new RestoreTargetInvalidError({
        reason: "restore target not found, or is not a managed database",
      }),
    );
  }
  if (target.engine !== ctx.engine) {
    return Result.err(
      new RestoreTargetInvalidError({
        reason: `cannot restore a ${ctx.engine} snapshot into a ${target.engine} database`,
      }),
    );
  }
  return Result.ok(target);
}

/** What the typed confirmation may say: the name (or id) of whatever the
 *  in-place restore overwrites, the target database when one is given. */
function confirmationNames(ctx: ExecutionContext, target: DatabaseTarget | null): string[] {
  if (target) return [target.resourceName, target.resourceId];
  return ctx.kind === "volume" ? [ctx.volumeName] : [ctx.resourceName, ctx.resourceId];
}

/**
 * Restore a succeeded backup. `download` streams the snapshot's file back out
 * (`dump`) and returns its bytes for the caller to hand to the user. `in-place`
 * streams it into the live database (postgres / mariadb / mongodb) or, for
 * volume runs, replaces the volume's contents: typed-name confirmed, one
 * restore per target at a time, refused while any container mounts a volume.
 * Every refusal and failure comes back as a typed RestoreError.
 */
export async function restoreBackup(input: {
  backupId: BackupId;
  mode: RestoreMode;
  /** Typed-name confirmation, required for the destructive in-place mode.
   *  Must equal the name of whatever gets OVERWRITTEN. The target database
   *  when one is given, otherwise the snapshot's own source. The UI collects
   *  it; we re-check here so a direct API call can't skip the gate. */
  confirm?: string;
  /** Restore into this database instead of the one the snapshot came from.
   *  Database runs only. A volume snapshot has no such notion. */
  targetResourceId?: ResourceId;
}): Promise<Result<RestoreOutput, RestoreError>> {
  const ctx = await getExecutionContext(input.backupId);
  if (!ctx) {
    return Result.err(
      new RestoreRefusedError({ reason: "this backup's source or destination no longer exists" }),
    );
  }

  // Resolved before the confirmation gate: what the operator has to type is
  // the name of the thing being overwritten, which differs once there's a target.
  const target = await resolveRestoreTarget(ctx, input.targetResourceId);
  if (target.isErr()) return Result.err(target.error);

  // In-place overwrites live data, require the typed-name confirmation
  // server-side, not just in the dialog.
  if (input.mode === "in-place") {
    const expected = confirmationNames(ctx, target.value);
    if (!input.confirm || !expected.includes(input.confirm)) {
      return Result.err(new RestoreConfirmationError({ expected: expected[0] ?? "" }));
    }
  }

  // `storagePath` holds the rustic snapshot id (set when the run succeeded).
  const snapshotId = ctx.storagePath;
  if (!snapshotId) {
    return Result.err(
      new RestoreRefusedError({
        reason: "this backup has no stored snapshot (the run did not succeed)",
      }),
    );
  }

  const run = { ctx, target: target.value, mode: input.mode, snapshotId };
  if (input.mode === "download") return recordRestore(input.backupId, run);

  // One in-place restore per write target: a second one streaming into the
  // same database (or volume) would interleave with the first.
  const scope = target.value?.resourceId ?? repoScope(ctx);
  if (!(await claimRestoreLock(scope, input.backupId))) {
    const label = target.value?.resourceName ?? confirmationNames(ctx, null)[0] ?? scope;
    return Result.err(new RestoreInProgressError({ target: label }));
  }
  try {
    return await recordRestore(input.backupId, run);
  } finally {
    // Best-effort: a stuck claim is cleared by the boot reaper, and must not
    // mask the restore's own outcome.
    await Result.tryPromise({
      try: () => releaseRestoreLock(scope, input.backupId),
      catch: errorFromUnknown,
    });
  }
}

interface RestoreRun {
  ctx: ExecutionContext;
  target: DatabaseTarget | null;
  mode: RestoreMode;
  snapshotId: string;
}

/** Run a restore that passed every gate under a persisted backup_restore row:
 *  history + observable status instead of an outcome that only ever lived
 *  inside this RPC. A refusal raised mid-way (a mounted volume, a stopped
 *  target) keeps its type; anything else is the restore failing. */
async function recordRestore(
  backupId: BackupId,
  run: RestoreRun,
): Promise<Result<RestoreOutput, RestoreRefusedError | RestoreFailedError>> {
  const restoreId = await createRestoreRun({
    organizationId: run.ctx.organizationId,
    backupId,
    mode: run.mode,
    targetResourceId: run.target?.resourceId ?? null,
  });
  const startedAt = performance.now();
  const outcome = await Result.tryPromise({
    try: () => performRestore(run.ctx, run.target, run.mode, run.snapshotId),
    catch: (cause) =>
      RestoreRefusedError.is(cause)
        ? cause
        : new RestoreFailedError({ reason: errorFromUnknown(cause).message, restoreId }),
  });
  await finishRestoreRun({
    id: restoreId,
    status: outcome.isOk() ? "succeeded" : "failed",
    errorMessage: outcome.isErr() ? outcome.error.message : null,
    durationMs: Math.round(performance.now() - startedAt),
  });
  return outcome;
}

async function performRestore(
  ctx: ExecutionContext,
  target: DatabaseTarget | null,
  mode: RestoreMode,
  snapshotId: string,
): Promise<RestoreOutput> {
  const cli = await openRepo(ctx);
  const filenameInSnapshot = ctx.kind === "volume" ? "volume.tar" : "dump";

  if (mode === "download") {
    const { sink, done } = bufferSink();
    await cli.dumpToStream({ snapshotId, filenameInSnapshot, out: sink });
    const bytes = await done;
    const filename =
      ctx.kind === "volume"
        ? `${ctx.backupId}.tar`
        : ctx.approach === "physical"
          ? `${ctx.backupId}.basebackup.tar`
          : `${ctx.backupId}.dump`;
    return { ok: true, bytes, filename };
  }

  // A physical base backup restores by extracting into a FRESH data directory
  // with the server stopped; streaming it into a live cluster would corrupt
  // it. Refuse with the operator path instead of attempting it.
  if (ctx.kind !== "volume" && ctx.approach === "physical") {
    throw new RestoreRefusedError({
      reason:
        "physical base backups cannot be restored in place: download the tar and extract it into a fresh PostgreSQL data directory",
    });
  }

  const docker = Docker.fromEnv();
  try {
    if (ctx.kind === "volume") return await restoreVolumeInPlace(docker, ctx, cli, snapshotId);
    // No explicit target: write back over the snapshot's own source.
    const writeTo: DatabaseTarget = target ?? {
      resourceId: ctx.resourceId,
      resourceName: ctx.resourceName,
      projectSlug: ctx.projectSlug,
      engine: ctx.engine,
      databaseName: ctx.databaseName,
      username: ctx.username,
      password: ctx.password,
    };
    return await restoreDatabaseInPlace(docker, writeTo, cli, {
      id: snapshotId,
      sourceDatabaseName: ctx.databaseName,
      sourceSizeBytes: ctx.sourceSizeBytes,
    });
  } finally {
    docker.destroy();
  }
}
