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
 */
import { createHash } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";

import { decryptBytes, encryptBytes } from "../lib/crypto";
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
import { dumpCommand, resolveSecret, runPreHook, shellQuote } from "./engine-helpers";
import { execCapture, execDump, findResourceContainerId } from "./exec";
import { type ResolvedDestination, archiveKey, getArchive, putArchive } from "./storage";
import {
  assertVolumeExists,
  dumpVolume,
  listVolumeMounters,
  restoreVolumeFromTar,
  volumeArchiveScope,
  volumeRestoreBlockReason,
} from "./volume";

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

/** Archive extension + storage-key scope for a run (kind-dependent). */
function archiveShape(ctx: ExecutionContext): { ext: string; scope: string } {
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

/** Resolve the destination + the archive's storage key for a run. Prefers the
 *  stored `storagePath` (what the engine actually wrote) and falls back to
 *  recomputing the key exactly as the write path built it. */
async function resolveArchiveLocation(
  ctx: ExecutionContext,
): Promise<{ dest: ResolvedDestination; key: string }> {
  const secret = await resolveSecret(ctx);
  const dest: ResolvedDestination = {
    type: ctx.destination.type,
    config: ctx.destination.config,
    secret,
  };
  if (ctx.storagePath) return { dest, key: ctx.storagePath };
  const { ext, scope } = archiveShape(ctx);
  const key = archiveKey({
    prefix:
      typeof ctx.destination.config.prefix === "string" ? ctx.destination.config.prefix : undefined,
    resourceId: scope,
    backupId: ctx.backupId,
    ext,
  });
  return { dest, key };
}

export type RestoreMode = "download" | "in-place";

/**
 * Restore a succeeded backup. `download` returns the decrypted, decompressed
 * archive bytes for the caller to hand to the user. `in-place` streams the
 * archive back into the live database (pg only) or, for volume runs, replaces
 * the volume's contents — refused while any container still mounts it.
 */
export async function restoreBackup(input: {
  backupId: string;
  mode: RestoreMode;
  /** Typed-name confirmation, required for the destructive in-place mode.
   *  Must equal the source's name (resource name/id, or the volume name). The
   *  UI collects it; we re-check here so a direct API call can't skip the gate. */
  confirm?: string;
}): Promise<{ ok: true; bytes?: Buffer; filename?: string }> {
  const ctx = await getExecutionContext(input.backupId as ExecutionContext["backupId"]);
  if (!ctx) throw new Error("backup execution context not found");

  // In-place overwrites live data — require the typed-name confirmation
  // server-side, not just in the dialog.
  if (input.mode === "in-place") {
    const expected = ctx.kind === "volume" ? [ctx.volumeName] : [ctx.resourceName, ctx.resourceId];
    if (!input.confirm || !expected.includes(input.confirm)) {
      throw new Error(
        `restore confirmation required: type "${expected[0]}" to confirm in-place restore`,
      );
    }
  }

  const { dest, key } = await resolveArchiveLocation(ctx);
  let body = await getArchive(dest, key);
  if (ctx.encryption === "aes-256-gcm") body = await decryptBytes(body);
  const plain = gunzipSync(body);

  if (input.mode === "download") {
    const filename = ctx.kind === "volume" ? `${ctx.backupId}.tar` : `${ctx.backupId}.dump`;
    return { ok: true, bytes: plain, filename };
  }

  const docker = Docker.fromEnv();
  try {
    if (ctx.kind === "volume") {
      // Guard: extracting under a container that mounts the volume — even a
      // stopped one that could restart mid-extract — risks a corrupt half-state.
      const mounters = await listVolumeMounters(docker, ctx.volumeName);
      const blocked = volumeRestoreBlockReason(mounters);
      if (blocked) throw new Error(blocked);
      await assertVolumeExists(docker, ctx.volumeName);
      await restoreVolumeFromTar(docker, ctx.volumeName, plain);
      return { ok: true };
    }

    // in-place: pipe the dump back into the live database.
    const serviceName = buildContainerName({
      engine: ctx.engine,
      projectSlug: ctx.projectSlug,
      resourceName: ctx.resourceName,
    });
    const containerId = await findResourceContainerId(docker, ctx.resourceId);
    if (!containerId) throw new Error(`No running container for ${serviceName}`);

    if (ctx.engine !== "postgres") {
      throw new Error(`in-place restore for ${ctx.engine} is not implemented`);
    }
    // pg_restore reads the custom-format dump from stdin. We stage it to a
    // temp file in the container then restore, to avoid stdin-attach plumbing.
    const b64 = plain.toString("base64");
    const tmp = `/tmp/restore-${ctx.backupId}.dump`;
    await execCapture(docker, containerId, [
      "sh",
      "-c",
      `echo ${shellQuote(b64)} | base64 -d > ${tmp}`,
    ]);
    // pg_restore exits non-zero on a genuinely failed restore. We allow
    // non-zero at the exec layer ONLY so we can capture stderr and surface it
    // — a silent `{ ok: true }` on a failed restore would mislead the caller
    // into thinking a corrupted/half-restored DB is fine. Always `rm -f` the
    // temp dump (separate exec so its exit can't mask pg_restore's).
    const restore = await execCapture(
      docker,
      containerId,
      [
        "sh",
        "-c",
        `pg_restore --clean --if-exists --no-owner -U ${shellQuote(
          ctx.username,
        )} -d ${shellQuote(ctx.databaseName)} ${tmp}`,
      ],
      { env: [`PGPASSWORD=${ctx.password}`], allowNonZero: true },
    );
    await execCapture(docker, containerId, ["rm", "-f", tmp], {
      allowNonZero: true,
    });
    if (restore.exitCode !== 0) {
      throw new Error(
        `pg_restore failed (exit ${restore.exitCode}): ${restore.stderr.slice(0, 2000)}`,
      );
    }
    return { ok: true };
  } finally {
    docker.destroy();
  }
}

export interface VerifyResult {
  /** False when the archive could not be fetched from its destination. */
  ok: boolean;
  /** sha256(stored body) == recorded checksum; null when unverifiable. */
  match: boolean | null;
  storedChecksum: string | null;
  computedChecksum: string | null;
  /** Bytes actually sitting at the destination (encrypted+compressed body). */
  archiveSizeBytes: number | null;
  /** Why verification couldn't run (unreachable archive, no stored checksum). */
  reason: string | null;
}

/**
 * Integrity check for a stored archive: re-fetch the bytes from the run's
 * destination and recompute sha256 over exactly what the engine hashed at
 * write time (the compressed, possibly-encrypted body). No decrypt/restore —
 * this proves the destination still holds the bytes the run recorded.
 */
export async function verifyBackup(backupId: string): Promise<VerifyResult> {
  const ctx = await getExecutionContext(backupId as ExecutionContext["backupId"]);
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

  if (!ctx.checksum) {
    return {
      ok: false,
      match: null,
      storedChecksum: null,
      computedChecksum: null,
      archiveSizeBytes: null,
      reason: "run recorded no checksum (did it succeed?)",
    };
  }

  try {
    const { dest, key } = await resolveArchiveLocation(ctx);
    const body = await getArchive(dest, key);
    const computed = createHash("sha256").update(body).digest("hex");
    return {
      ok: true,
      match: computed === ctx.checksum,
      storedChecksum: ctx.checksum,
      computedChecksum: computed,
      archiveSizeBytes: body.length,
      reason: null,
    };
  } catch (cause) {
    return {
      ok: false,
      match: null,
      storedChecksum: ctx.checksum,
      computedChecksum: null,
      archiveSizeBytes: null,
      reason: cause instanceof Error ? cause.message : String(cause),
    };
  }
}
