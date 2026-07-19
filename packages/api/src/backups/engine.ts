/**
 * Backup execution engine. Streams the run's source straight into `rustic`
 * (dedup + incremental + zstd + repo-key encryption — see rustic.ts) as backup
 * stdin, so nothing is buffered in RAM:
 *   `database`: a logical dump exec'd inside the DB's own container (no creds on
 *               the wire — see exec.ts);
 *   `volume`  : a tar of a named Docker volume streamed out of a read-only
 *               helper container (see volume.ts).
 * One repo per (resource × destination); each run is one tagged snapshot.
 * rustic owns compression + encryption, so the old gzip/aes/checksum/stage/put
 * plumbing is gone. `storagePath` now holds the snapshot id.
 *
 * v1 covers logical dumps for postgres / mariadb / mongodb plus volume tars.
 * redis logical dumps are rejected with a pointer to volume backups.
 *
 * Restore + verify of snapshots live in restore.ts.
 */
import type { Readable } from "node:stream";

import { Docker } from "@otterdeploy/docker";

import type { ResolvedDestination } from "./backends";

import { emitPlatformEvent } from "../notifications/emit";
import { buildContainerName } from "../routers/project/views";
import { deriveRepoId, toRusticRepo } from "./backends";
import {
  type ExecutionContext,
  appendBackupLog,
  getExecutionContext,
  markBackupFailed,
  markBackupRunning,
  markBackupSucceeded,
} from "./db";
import { dumpCommand, resolveSecret, runPreHook } from "./engine-helpers";
import { execDump, findResourceContainerId } from "./exec";
import { RusticCli } from "./rustic";
import { assertVolumeExists, dumpVolume } from "./volume";

type LogFn = (stream: "stdout" | "stderr" | "system", line: string) => Promise<void>;

/** Human source label for logs + notification copy. */
function sourceLabel(ctx: ExecutionContext): string {
  return ctx.kind === "volume" ? `volume ${ctx.volumeName}` : ctx.resourceName;
}

/** Display context for the platform event (already-formatted strings). */
function eventData(ctx: ExecutionContext): Record<string, string> {
  return ctx.kind === "volume"
    ? { backupId: ctx.backupId, volume: ctx.volumeName }
    : {
        backupId: ctx.backupId,
        resourceId: ctx.resourceId,
        resource: ctx.resourceName,
        project: ctx.projectSlug,
      };
}

/**
 * A live dump of the run's source, ready to pipe into rustic. `stream` is the
 * raw archive bytes (a logical dump or a volume tar); `stderr()`/`exitCode`
 * settle once the underlying dump/tar exits and can only be awaited after the
 * stream has been drained (rustic does that). `method` is a human label for the
 * run row.
 */
interface ArchiveStream {
  stream: Readable;
  method: string;
  stderr: () => Promise<string>;
  exitCode: Promise<number>;
}

/** Open a streaming dump of the run's source (no bytes buffered here). */
async function produceArchive(
  docker: Docker,
  ctx: ExecutionContext,
  log: LogFn,
): Promise<ArchiveStream> {
  if (ctx.kind === "volume") {
    await assertVolumeExists(docker, ctx.volumeName);
    await log("system", "Streaming tar from a read-only helper container");
    const dump = dumpVolume(docker, ctx.volumeName);
    return { ...dump, method: "tar (helper container, ro mount) → rustic" };
  }

  const serviceName = buildContainerName({
    engine: ctx.engine,
    projectSlug: ctx.projectSlug,
    resourceName: ctx.resourceName,
  });
  const containerId = await findResourceContainerId(docker, ctx.resourceId);
  if (!containerId) {
    throw new Error(`No running container for service ${serviceName} — is the database up?`);
  }
  await log("system", `Exec into ${serviceName} (${containerId.slice(0, 12)})`);

  await runPreHook(docker, containerId, ctx.preHook, log);

  const { cmd, env, method } = dumpCommand(ctx);
  const dump = await execDump(docker, containerId, cmd, env);
  return { stream: dump.stream, method, stderr: dump.stderr, exitCode: dump.exitCode };
}

/**
 * Execute a queued backup run end-to-end. Always resolves — terminal status is
 * written to the row and surfaced via the log stream — so callers can fire it
 * detached without unhandled rejections.
 */
export async function executeBackup(backupId: string): Promise<void> {
  const ctx = await getExecutionContext(backupId as ExecutionContext["backupId"]);
  if (!ctx) {
    await markBackupFailed(
      backupId as ExecutionContext["backupId"],
      "execution context not found (source or destination missing)",
    );
    return;
  }

  const log: LogFn = (stream, line) => appendBackupLog(ctx.backupId, stream, line);

  const docker = Docker.fromEnv();
  try {
    await markBackupRunning(ctx.backupId);
    await log(
      "system",
      ctx.kind === "volume"
        ? `Starting volume backup of ${ctx.volumeName}`
        : `Starting ${ctx.engine} backup of ${ctx.databaseName}`,
    );

    const source = await produceArchive(docker, ctx, log);

    // Resolve the (resource × destination) repo, derive its password + backend
    // options, and open it (idempotent init tolerates an existing repo).
    const repoId = deriveRepoId(ctx);
    const secret = await resolveSecret(ctx);
    const dest: ResolvedDestination = {
      type: ctx.destination.type,
      config: ctx.destination.config,
      secret,
    };
    const cli = new RusticCli(toRusticRepo(dest, repoId), log);
    await cli.ensureInit();
    await log("system", `Streaming into repo ${repoId}`);

    // Pipe the live dump/tar straight into `rustic backup -` — rustic dedups,
    // compresses (zstd), and encrypts under the repo key. Draining the stream
    // is what lets the dump/tar exit be observed, so the exit check comes after.
    const result = await cli.backupStdin({
      stdin: source.stream,
      stdinFilename: ctx.kind === "volume" ? "volume.tar" : "dump",
      tags: ["otterdeploy", `backup:${ctx.backupId}`, `schedule:${ctx.scheduleId ?? "manual"}`],
    });

    // The snapshot is only trustworthy if the source producer exited cleanly —
    // a failed pg_dump/tar can still end its stdout, leaving rustic a truncated
    // archive it happily snapshots. Fail the run so a partial backup never
    // reads as succeeded.
    const dumpExit = await source.exitCode;
    const dumpStderr = (await source.stderr()).trim();
    if (dumpStderr) await log("stderr", dumpStderr.slice(0, 4000));
    if (dumpExit !== 0) {
      const what = ctx.kind === "volume" ? "volume tar" : "dump";
      throw new Error(`${what} exited ${dumpExit}: ${dumpStderr.slice(0, 1000)}`);
    }

    await markBackupSucceeded(ctx.backupId, {
      storagePath: result.snapshotId,
      // rustic owns integrity (`check`); no blob checksum is computed here.
      checksum: null,
      compressedSizeBytes: result.addedBytes,
      sourceSizeBytes: result.sourceSizeBytes,
      durationMs: result.durationMs,
      method: source.method,
    });
    await log(
      "system",
      `Backup succeeded — snapshot ${result.snapshotId.slice(0, 12)} (+${result.addedBytes} B)`,
    );
    await emitPlatformEvent({
      organizationId: ctx.organizationId,
      eventId: "backup.succeeded",
      title: "Backup succeeded",
      message:
        ctx.kind === "volume"
          ? `Volume ${ctx.volumeName} backed up successfully.`
          : `${ctx.resourceName} (${ctx.projectSlug}) backed up successfully.`,
      data: eventData(ctx),
    });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    await log("system", `Backup failed: ${message}`);
    await markBackupFailed(ctx.backupId, message);
    await emitPlatformEvent({
      organizationId: ctx.organizationId,
      eventId: "backup.failed",
      title: "Backup failed",
      message: `${sourceLabel(ctx)}${ctx.kind === "database" ? ` (${ctx.projectSlug})` : ""}: ${message}`,
      data: eventData(ctx),
    });
  } finally {
    docker.destroy();
  }
}
