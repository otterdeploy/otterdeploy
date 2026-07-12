import { Docker } from "@otterdeploy/docker";
/**
 * Backup execution engine. Produces an archive for the run's source —
 * `database`: a logical dump exec'd inside the DB's own container (no creds on
 * the wire — see exec.ts); `volume`: a tar of a named Docker volume streamed
 * out of a read-only helper container (see volume.ts) — then compresses it,
 * optionally encrypts at rest, checksums it, and stores it to the run's
 * destination.
 *
 * v1 covers logical dumps for postgres / mariadb / mongodb plus volume tars.
 * redis logical dumps are rejected with a pointer to volume backups. The
 * archive is buffered in memory then stored in a single write — adequate for
 * application databases; streaming-to-storage for very large datasets is the
 * next iteration.
 *
 * Restore + verify of stored archives live in restore.ts.
 */
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";

import { encryptBytes } from "../lib/crypto";
import { removeStagedBackup, stageBackupArchive } from "../lib/data-dir";
import { emitPlatformEvent } from "../notifications/emit";
import { buildContainerName } from "../routers/project/views";
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
import { type ResolvedDestination, archiveKey, putArchive } from "./storage";
import { assertVolumeExists, dumpVolume, volumeArchiveScope } from "./volume";

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

/** Archive extension + storage-key scope for a run (kind-dependent).
 *  Shared with restore.ts, which recomputes keys the same way. */
export function archiveShape(ctx: ExecutionContext): { ext: string; scope: string } {
  if (ctx.kind === "volume") {
    return { ext: "tar.gz", scope: volumeArchiveScope(ctx.volumeName) };
  }
  const ext =
    ctx.engine === "postgres" ? "dump.gz" : ctx.engine === "mariadb" ? "sql.gz" : "archive.gz";
  return { ext, scope: ctx.resourceId };
}

/** Produce the raw (uncompressed) archive bytes for the run's source. */
async function produceArchive(
  docker: Docker,
  ctx: ExecutionContext,
  log: LogFn,
): Promise<{ archive: Buffer; method: string }> {
  if (ctx.kind === "volume") {
    await assertVolumeExists(docker, ctx.volumeName);
    await log("system", "Streaming tar from a read-only helper container");
    const { archive, stderr } = await dumpVolume(docker, ctx.volumeName);
    if (stderr.trim()) await log("stderr", stderr.trim().slice(0, 4000));
    return { archive, method: "tar (helper container, ro mount) | gzip" };
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
  if (dump.exitCode !== 0) {
    throw new Error(`dump exited ${dump.exitCode}: ${dump.stderr.slice(0, 1000)}`);
  }
  if (dump.stderr.trim()) await log("stderr", dump.stderr.trim().slice(0, 4000));
  return { archive: dump.archive, method };
}

/**
 * Execute a queued backup run end-to-end. Always resolves — terminal status is
 * written to the row and surfaced via the log stream — so callers can fire it
 * detached without unhandled rejections.
 */
export async function executeBackup(backupId: string): Promise<void> {
  const started = Date.now();
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

    const { archive, method } = await produceArchive(docker, ctx, log);
    const sourceSize = archive.length;
    await log("system", `Dumped ${sourceSize} bytes; compressing`);

    // Compress, then optionally encrypt at rest.
    let body: Buffer = gzipSync(archive);
    if (ctx.encryption === "aes-256-gcm") {
      body = await encryptBytes(body);
      await log("system", "Encrypted archive (aes-256-gcm)");
    } else if (ctx.encryption === "kms-managed" || ctx.encryption === "customer-key") {
      throw new Error(`encryption mode ${ctx.encryption} is not implemented`);
    }

    const checksum = createHash("sha256").update(body).digest("hex");
    const secret = await resolveSecret(ctx);
    const dest: ResolvedDestination = {
      type: ctx.destination.type,
      config: ctx.destination.config,
      secret,
    };
    const { ext, scope } = archiveShape(ctx);
    const key = archiveKey({
      prefix:
        typeof ctx.destination.config.prefix === "string"
          ? ctx.destination.config.prefix
          : undefined,
      resourceId: scope,
      backupId: ctx.backupId,
      ext,
    });
    // Land the archive in the host data folder before the (possibly
    // off-cluster) upload — predictable staging that stays put if the upload
    // throws, for inspection/retry. The data-folder sweep reclaims stale ones.
    // Volume runs skip it: the staging layout is keyed project/resource, and a
    // volume has neither.
    const staged =
      ctx.kind === "database"
        ? await stageBackupArchive({
            projectId: ctx.projectId,
            resourceId: ctx.resourceId,
            backupId: ctx.backupId,
            ext,
            body,
          })
        : null;
    if (staged) await log("system", `Staged archive → ${staged}`);

    const { storagePath } = await putArchive(dest, key, body);
    await log("system", `Stored ${body.length} bytes → ${storagePath}`);

    // Upload landed — drop the staging copy (kept only when the upload failed).
    if (staged) await removeStagedBackup(staged);

    await markBackupSucceeded(ctx.backupId, {
      storagePath,
      checksum,
      compressedSizeBytes: body.length,
      sourceSizeBytes: sourceSize,
      durationMs: Date.now() - started,
      method,
    });
    await log("system", "Backup succeeded");
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
