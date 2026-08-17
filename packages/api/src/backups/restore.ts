/**
 * Restore + verify for rustic snapshots. `restoreBackup` hands back the snapshot
 * file bytes (download) or streams them into the live database/volume (in-place,
 * typed-name-confirmed); `verifyBackup` runs a structural repo `check` and
 * confirms the recorded snapshot still resolves. rustic owns dedup + zstd +
 * repo-key encryption, so there is no decrypt/gunzip/checksum plumbing here. A
 * run's `storagePath` is the snapshot id, which is all we need to address it.
 * Split out of engine.ts, which keeps the backup write path (executeBackup).
 */
import type { BackupId, ResourceId } from "@otterdeploy/shared/id";
import type { Writable } from "node:stream";

import { Docker } from "@otterdeploy/docker";
import { Result } from "better-result";
import { Writable as NodeWritable } from "node:stream";

import type { ResolvedDestination } from "./backends";

import { deriveRepoKey, toRusticRepo } from "./backends";
import {
  type DatabaseTarget,
  type ExecutionContext,
  getExecutionContext,
  resolveDatabaseTarget,
} from "./db";
import { resolveSecret } from "./engine-helpers";
import { createRestoreRun, finishRestoreRun } from "./restore-db";
import { restoreDatabaseInPlace, restoreVolumeInPlace } from "./restore-in-place";
import { RusticCli } from "./rustic";

/** Open the run's rustic repo: resolve backend creds, derive the (resource ×
 *  destination) repo key + its password, and build a driver. */
async function openRepo(ctx: ExecutionContext): Promise<RusticCli> {
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

/**
 * Restore a succeeded backup. `download` streams the snapshot's file back out
 * (`dump`) and returns its bytes for the caller to hand to the user. `in-place`
 * streams it into the live database (postgres / mariadb / mongodb) or, for
 * volume runs, replaces the volume's contents. Refused while any container
 * still mounts it.
 */
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
): Promise<DatabaseTarget | null> {
  if (!targetResourceId) return null;
  if (ctx.kind === "volume") {
    throw new Error("a volume snapshot cannot be restored into a database");
  }
  if (targetResourceId === ctx.resourceId) return null;
  const target = await resolveDatabaseTarget(targetResourceId, ctx.organizationId);
  if (!target) throw new Error("restore target not found, or is not a managed database");
  if (target.engine !== ctx.engine) {
    throw new Error(`cannot restore a ${ctx.engine} snapshot into a ${target.engine} database`);
  }
  return target;
}

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
}): Promise<{ ok: true; bytes?: Buffer; filename?: string }> {
  const ctx = await getExecutionContext(input.backupId);
  if (!ctx) throw new Error("backup execution context not found");

  // Resolved before the confirmation gate: what the operator has to type is
  // the name of the thing being overwritten, which differs once there's a target.
  const target = await resolveRestoreTarget(ctx, input.targetResourceId);

  // In-place overwrites live data, require the typed-name confirmation
  // server-side, not just in the dialog.
  if (input.mode === "in-place") {
    const expected = target
      ? [target.resourceName, target.resourceId]
      : ctx.kind === "volume"
        ? [ctx.volumeName]
        : [ctx.resourceName, ctx.resourceId];
    if (!input.confirm || !expected.includes(input.confirm)) {
      throw new Error(
        `restore confirmation required: type "${expected[0]}" to confirm in-place restore`,
      );
    }
  }

  // `storagePath` holds the rustic snapshot id (set when the run succeeded).
  const snapshotId = ctx.storagePath;
  if (!snapshotId) throw new Error("backup has no stored snapshot (did the run succeed?)");

  // Every attempt past the gates gets a persisted row: history + observable
  // status instead of an outcome that only ever lived inside this RPC.
  const restoreId = await createRestoreRun({
    organizationId: ctx.organizationId,
    backupId: input.backupId,
    mode: input.mode,
    targetResourceId: target?.resourceId ?? null,
  });
  const startedAt = Date.now();
  const outcome = await Result.tryPromise({
    try: () => performRestore(ctx, target, input.mode, snapshotId),
    catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
  });
  if (outcome.isErr()) {
    await finishRestoreRun({
      id: restoreId,
      status: "failed",
      errorMessage: outcome.error.message,
      durationMs: Date.now() - startedAt,
    });
    throw outcome.error;
  }
  await finishRestoreRun({
    id: restoreId,
    status: "succeeded",
    durationMs: Date.now() - startedAt,
  });
  return outcome.value;
}

async function performRestore(
  ctx: ExecutionContext,
  target: DatabaseTarget | null,
  mode: RestoreMode,
  snapshotId: string,
): Promise<{ ok: true; bytes?: Buffer; filename?: string }> {
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
    throw new Error(
      "physical base backups cannot be restored in place: download the tar and extract it into a fresh PostgreSQL data directory",
    );
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
    return await restoreDatabaseInPlace(docker, writeTo, cli, snapshotId, ctx.sourceSizeBytes);
  } finally {
    docker.destroy();
  }
}

export interface VerifyResult {
  /** False when the repo could not be reached / checked. */
  ok: boolean;
  /** Repo `check` passed AND the recorded snapshot still resolves; null when
   *  verification couldn't run. */
  match: boolean | null;
  /** The recorded snapshot id (rustic addresses integrity by id, not a blob hash). */
  storedChecksum: string | null;
  /** Always null: rustic owns integrity structurally; there is no blob hash to recompute. */
  computedChecksum: string | null;
  /** Not exposed by the rustic check/snapshotExists surface, always null here. */
  archiveSizeBytes: number | null;
  /** Why verification couldn't run (no snapshot recorded, repo unreachable). */
  reason: string | null;
}

/**
 * Integrity check for a stored snapshot: run rustic's structural `check` over
 * the whole repo, then confirm the run's recorded snapshot id still resolves.
 * This proves the destination still holds an intact repo containing the exact
 * snapshot the run recorded, no download/decrypt/restore needed.
 */
export async function verifyBackup(backupId: BackupId): Promise<VerifyResult> {
  const ctx = await getExecutionContext(backupId);
  if (!ctx) {
    return {
      ok: false,
      match: null,
      storedChecksum: null,
      computedChecksum: null,
      archiveSizeBytes: null,
      reason: "backup execution context not found",
    };
  }

  const snapshotId = ctx.storagePath;
  if (!snapshotId) {
    return {
      ok: false,
      match: null,
      storedChecksum: null,
      computedChecksum: null,
      archiveSizeBytes: null,
      reason: "run recorded no snapshot (did it succeed?)",
    };
  }

  try {
    const cli = await openRepo(ctx);
    // `check` throws on structural repo/pack corruption; `snapshotExists`
    // confirms the specific snapshot the row points at is still present.
    await cli.check();
    const exists = await cli.snapshotExists(snapshotId);
    return {
      ok: true,
      match: exists,
      storedChecksum: snapshotId,
      computedChecksum: null,
      archiveSizeBytes: null,
      reason: exists ? null : "recorded snapshot no longer resolves in the repo",
    };
  } catch (cause) {
    return {
      ok: false,
      match: null,
      storedChecksum: snapshotId,
      computedChecksum: null,
      archiveSizeBytes: null,
      reason: cause instanceof Error ? cause.message : String(cause),
    };
  }
}
