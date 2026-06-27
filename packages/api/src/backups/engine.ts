import { Docker } from "@otterdeploy/docker";
/**
 * Backup execution engine. Runs a logical database dump inside the engine's
 * own container (no creds on the wire — see exec.ts), compresses it, optionally
 * encrypts at rest, checksums it, and stores it to the run's destination.
 *
 * v1 covers logical dumps for postgres / mariadb / mongodb. redis and
 * volume/stack kinds are rejected with a clear failure rather than a silent
 * no-op. The dump is buffered in memory then stored in a single write —
 * adequate for application databases; streaming-to-storage for very large
 * datasets is the next iteration.
 */
import { createHash } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";

import { decryptBytes, decryptSecret, encryptBytes } from "../lib/crypto";
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
import { execCapture, execDump, findServiceContainerId } from "./exec";
import { type ResolvedDestination, archiveKey, getArchive, putArchive } from "./storage";

async function resolveSecret(ctx: ExecutionContext): Promise<Record<string, string>> {
  if (!ctx.destination.encryptedSecret) return {};
  const json = await decryptSecret(ctx.destination.encryptedSecret);
  return JSON.parse(json) as Record<string, string>;
}

function dumpCommand(ctx: ExecutionContext): {
  cmd: string[];
  env: string[];
  ext: string;
  method: string;
} {
  switch (ctx.engine) {
    case "postgres":
      return {
        cmd: [
          "pg_dump",
          "--format=custom",
          "--no-owner",
          "--no-privileges",
          "-U",
          ctx.username,
          "-d",
          ctx.databaseName,
        ],
        env: [`PGPASSWORD=${ctx.password}`],
        ext: "dump.gz",
        method: "pg_dump --format=custom | gzip",
      };
    case "mariadb":
      return {
        cmd: [
          "sh",
          "-c",
          `exec mysqldump -u ${shellQuote(ctx.username)} ${shellQuote(ctx.databaseName)}`,
        ],
        env: [`MYSQL_PWD=${ctx.password}`],
        ext: "sql.gz",
        method: "mysqldump | gzip",
      };
    case "mongodb":
      return {
        cmd: [
          "mongodump",
          "--archive",
          `--db=${ctx.databaseName}`,
          `--username=${ctx.username}`,
          `--password=${ctx.password}`,
          "--authenticationDatabase=admin",
        ],
        env: [],
        ext: "archive.gz",
        method: "mongodump --archive | gzip",
      };
    case "redis":
      throw new Error("redis backups are not supported (no logical dump); use a volume backup");
  }
}

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

type LogFn = (stream: "stdout" | "stderr" | "system", line: string) => Promise<void>;

/**
 * Run a schedule's pre-backup hook inside the DB container before dumping. No-op
 * when unset; a non-zero exit aborts the backup (the caller catches + fails it).
 */
async function runPreHook(
  docker: Docker,
  containerId: string,
  preHook: string | null,
  log: LogFn,
): Promise<void> {
  if (!preHook || !preHook.trim()) return;
  await log("system", `Running pre-hook: ${preHook}`);
  const hook = await execCapture(docker, containerId, ["sh", "-c", preHook], {
    allowNonZero: true,
  });
  if (hook.stdout.trim()) await log("stdout", hook.stdout.trim().slice(0, 4000));
  if (hook.stderr.trim()) await log("stderr", hook.stderr.trim().slice(0, 4000));
  if (hook.exitCode !== 0) throw new Error(`pre-hook exited ${hook.exitCode}`);
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
      "execution context not found (resource or destination missing)",
    );
    return;
  }

  const log = (stream: "stdout" | "stderr" | "system", line: string) =>
    appendBackupLog(ctx.backupId, stream, line);

  const docker = Docker.fromEnv();
  try {
    await markBackupRunning(ctx.backupId);
    await log("system", `Starting ${ctx.engine} backup of ${ctx.databaseName}`);

    const serviceName = buildContainerName({
      engine: ctx.engine,
      projectSlug: ctx.projectSlug,
      resourceName: ctx.resourceName,
    });
    const containerId = await findServiceContainerId(docker, serviceName);
    if (!containerId) {
      throw new Error(`No running container for service ${serviceName} — is the database up?`);
    }
    await log("system", `Exec into ${serviceName} (${containerId.slice(0, 12)})`);

    await runPreHook(docker, containerId, ctx.preHook, log);

    const { cmd, env, ext, method } = dumpCommand(ctx);
    const dump = await execDump(docker, containerId, cmd, env);
    if (dump.exitCode !== 0) {
      throw new Error(`dump exited ${dump.exitCode}: ${dump.stderr.slice(0, 1000)}`);
    }
    if (dump.stderr.trim()) await log("stderr", dump.stderr.trim().slice(0, 4000));
    const sourceSize = dump.archive.length;
    await log("system", `Dumped ${sourceSize} bytes; compressing`);

    // Compress, then optionally encrypt at rest.
    let body: Buffer = gzipSync(dump.archive);
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
    const key = archiveKey({
      prefix:
        typeof ctx.destination.config.prefix === "string"
          ? ctx.destination.config.prefix
          : undefined,
      resourceId: ctx.resourceId,
      backupId: ctx.backupId,
      ext,
    });
    // Land the archive in the host data folder before the (possibly
    // off-cluster) upload — predictable staging that stays put if the upload
    // throws, for inspection/retry. The data-folder sweep reclaims stale ones.
    const staged = await stageBackupArchive({
      projectId: ctx.projectId,
      resourceId: ctx.resourceId,
      backupId: ctx.backupId,
      ext,
      body,
    });
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
      message: `${ctx.resourceName} (${ctx.projectSlug}) backed up successfully.`,
      data: {
        backupId: ctx.backupId,
        resourceId: ctx.resourceId,
        resource: ctx.resourceName,
        project: ctx.projectSlug,
      },
    });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    await log("system", `Backup failed: ${message}`);
    await markBackupFailed(ctx.backupId, message);
    await emitPlatformEvent({
      organizationId: ctx.organizationId,
      eventId: "backup.failed",
      title: "Backup failed",
      message: `${ctx.resourceName} (${ctx.projectSlug}): ${message}`,
      data: {
        backupId: ctx.backupId,
        resourceId: ctx.resourceId,
        resource: ctx.resourceName,
        project: ctx.projectSlug,
      },
    });
  } finally {
    docker.destroy();
  }
}

export type RestoreMode = "download" | "in-place";

/**
 * Restore a succeeded backup. `download` returns the decrypted, decompressed
 * archive bytes for the caller to hand to the user. `in-place` streams the
 * archive back into the live database via the engine's restore client.
 */
export async function restoreBackup(input: {
  backupId: string;
  mode: RestoreMode;
  /** Typed-name confirmation, required for the destructive in-place mode.
   *  Must equal the resource's name (or id). The UI collects it; we re-check
   *  here so a direct API call can't skip the gate. */
  confirm?: string;
}): Promise<{ ok: true; bytes?: Buffer }> {
  const ctx = await getExecutionContext(input.backupId as ExecutionContext["backupId"]);
  if (!ctx) throw new Error("backup execution context not found");

  // In-place overwrites live data — require the typed-name confirmation
  // server-side, not just in the dialog.
  if (input.mode === "in-place") {
    const expected = [ctx.resourceName, ctx.resourceId];
    if (!input.confirm || !expected.includes(input.confirm)) {
      throw new Error(
        `restore confirmation required: type "${ctx.resourceName}" to confirm in-place restore`,
      );
    }
  }

  const secret = await resolveSecret(ctx);
  const dest: ResolvedDestination = {
    type: ctx.destination.type,
    config: ctx.destination.config,
    secret,
  };
  // For local destinations the stored key IS the absolute path; recompute the
  // S3 key the same way the engine wrote it.
  const ext =
    ctx.engine === "postgres" ? "dump.gz" : ctx.engine === "mariadb" ? "sql.gz" : "archive.gz";
  const key = archiveKey({
    prefix:
      typeof ctx.destination.config.prefix === "string" ? ctx.destination.config.prefix : undefined,
    resourceId: ctx.resourceId,
    backupId: ctx.backupId,
    ext,
  });

  let body = await getArchive(dest, dest.type === "local" ? key : key);
  if (ctx.encryption === "aes-256-gcm") body = await decryptBytes(body);
  const plain = gunzipSync(body);

  if (input.mode === "download") {
    return { ok: true, bytes: plain };
  }

  // in-place: pipe the dump back into the live database.
  const docker = Docker.fromEnv();
  try {
    const serviceName = buildContainerName({
      engine: ctx.engine,
      projectSlug: ctx.projectSlug,
      resourceName: ctx.resourceName,
    });
    const containerId = await findServiceContainerId(docker, serviceName);
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
