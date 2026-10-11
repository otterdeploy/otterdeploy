/**
 * The destructive halves of restore: writing a snapshot back into a live
 * database container (postgres / mariadb / mongodb, via the engine's own
 * in-container restore client) or replacing a named volume's contents. Split
 * from restore.ts, which keeps the gates (typed-name confirm, target
 * resolution) and the persisted-run bookkeeping.
 */
import type { Docker } from "@otterdeploy/docker";
import type { Writable } from "node:stream";

import { errorFromUnknown } from "@otterdeploy/shared/promise";
import { Result } from "better-result";
import { Writable as NodeWritable } from "node:stream";

import type { DatabaseTarget, ExecutionContext } from "./db";
import type { RusticCli } from "./rustic";

import { buildContainerName } from "../routers/project/views";
import {
  engineDataDir,
  restoreCommand,
  restoreFailureIsBenign,
  restoreShortfall,
} from "./engine-helpers";
import { execCapture, findResourceContainerId } from "./exec";
import { RestoreRefusedError } from "./restore-errors";
import { streamSnapshotIntoExec } from "./restore-stream";
import {
  assertVolumeExists,
  listVolumeMounters,
  restoreVolumeFromTar,
  volumeRestoreBlockReason,
} from "./volume";

type VolumeContext = Extract<ExecutionContext, { kind: "volume" }>;

/** A buffer-collecting Writable + completion promise (volume tar sink). */
function tarSink(): { sink: Writable; done: Promise<Buffer> } {
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

/** In-place restore of a named volume: refuse while any container mounts it,
 *  then reload the snapshot's tar via the backup path's helper mechanics. */
export async function restoreVolumeInPlace(
  docker: Docker,
  ctx: VolumeContext,
  cli: RusticCli,
  snapshotId: string,
): Promise<{ ok: true }> {
  // Guard: extracting under a container that mounts the volume, even a stopped
  // one that could restart mid-extract, risks a corrupt half-state.
  const mounters = await listVolumeMounters(docker, ctx.volumeName);
  const blocked = volumeRestoreBlockReason(mounters);
  if (blocked) throw new RestoreRefusedError({ reason: blocked });
  await assertVolumeExists(docker, ctx.volumeName);
  // Stream the tar out of the snapshot, then load it back through the same
  // helper-container mechanics the backup path uses (clear + putArchive).
  const { sink, done } = tarSink();
  await cli.dumpToStream({ snapshotId, filenameInSnapshot: "volume.tar", out: sink });
  const tar = await done;
  await restoreVolumeFromTar(docker, ctx.volumeName, tar);
  return { ok: true };
}

/**
 * Disk-space preflight for an in-place restore (databasus's rule: required
 * size + 10% buffer). Best-effort: a container without `df`, or an unknown
 * data mount, must not block the restore, but a KNOWN shortfall fails before
 * the destructive part starts.
 */
async function assertDiskSpace(
  docker: Docker,
  containerId: string,
  target: DatabaseTarget,
  requiredBytes: number | null,
): Promise<void> {
  if (requiredBytes == null || requiredBytes <= 0) return;
  const probe = await Result.tryPromise({
    try: () =>
      execCapture(docker, containerId, ["df", "-Pk", engineDataDir(target.engine)], {
        allowNonZero: true,
      }),
    catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
  });
  if (probe.isErr() || probe.value.exitCode !== 0) return;
  const lines = probe.value.stdout.trim().split("\n");
  const last = lines.at(-1);
  const availKb = last ? Number.parseInt(last.trim().split(/\s+/)[3] ?? "", 10) : Number.NaN;
  if (!Number.isFinite(availKb)) return;
  const needed = requiredBytes * 1.1;
  if (availKb * 1024 < needed) {
    throw new RestoreRefusedError({
      reason:
        `not enough disk space for the restore: ${Math.round(needed / 1e6)} MB needed, ` +
        `${Math.round((availKb * 1024) / 1e6)} MB free on ${engineDataDir(target.engine)}`,
    });
  }
}

/** In-place restore of a database: stream the snapshot's dump into the
 *  engine's in-container restore client (pg_restore / mysql / mongorestore)
 *  over a hijacked exec duplex; fail the run on a non-zero exit. A silent
 *  `{ ok: true }` on a half-restored DB would mislead the caller. */
export async function restoreDatabaseInPlace(
  docker: Docker,
  target: DatabaseTarget,
  cli: RusticCli,
  snapshot: {
    id: string;
    /** The database the dump was taken from (namespaces in a mongo archive). */
    sourceDatabaseName: string;
    sourceSizeBytes: number | null;
  },
): Promise<{ ok: true }> {
  const serviceName = buildContainerName({
    engine: target.engine,
    projectSlug: target.projectSlug,
    resourceName: target.resourceName,
    stored: target.serviceName,
  });
  const containerId = await findResourceContainerId(docker, target.resourceId);
  if (!containerId) {
    throw new RestoreRefusedError({
      reason: `${serviceName} is not running: start the database before restoring into it`,
    });
  }

  // Refuses engines with no restore client (redis, clickhouse) BEFORE any
  // destructive work, and the preflight refuses a known disk shortfall.
  const command = Result.try({
    try: () => restoreCommand(target, { databaseName: snapshot.sourceDatabaseName }),
    catch: (cause) => new RestoreRefusedError({ reason: errorFromUnknown(cause).message }),
  });
  if (command.isErr()) throw command.error;
  const { cmd, env, method } = command.value;
  await assertDiskSpace(docker, containerId, target, snapshot.sourceSizeBytes);

  const restore = await streamSnapshotIntoExec({
    docker,
    containerId,
    cmd,
    env,
    cli,
    snapshotId: snapshot.id,
    filenameInSnapshot: "dump",
  });
  if (
    restore.exitCode !== 0 &&
    !restoreFailureIsBenign(target.engine, restore.exitCode, restore.stderr)
  ) {
    throw new Error(
      `${method} failed (exit ${restore.exitCode}): ${restore.stderr.slice(0, 2000)}`,
    );
  }
  // Exit 0 is not proof the snapshot landed: a restore that wrote nothing
  // must not be recorded as succeeded.
  const shortfall = restoreShortfall(target.engine, restore.stderr);
  if (shortfall) throw new Error(`${method} did not restore the snapshot: ${shortfall}`);
  return { ok: true };
}
