/**
 * Restore + verify for stored backup archives. `restoreBackup` hands back the
 * decrypted bytes (download) or streams them into the live database/volume
 * (in-place, typed-name-confirmed); `verifyBackup` re-fetches the stored body
 * and recomputes its checksum. Split out of engine.ts, which keeps the
 * backup write path (executeBackup).
 */
import { Docker } from "@otterdeploy/docker";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";

import { decryptBytes } from "../lib/crypto";
import { buildContainerName } from "../routers/project/views";
import { type ExecutionContext, getExecutionContext } from "./db";
import { archiveShape } from "./engine";
import { resolveSecret, shellQuote } from "./engine-helpers";
import { execCapture, findResourceContainerId } from "./exec";
import { type ResolvedDestination, archiveKey, getArchive } from "./storage";
import {
  assertVolumeExists,
  listVolumeMounters,
  restoreVolumeFromTar,
  volumeRestoreBlockReason,
} from "./volume";

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
