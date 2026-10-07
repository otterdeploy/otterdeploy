/**
 * Structural integrity check of a run's stored snapshot: rustic `check` over
 * the whole repo, then confirm the run's recorded snapshot id still resolves.
 * Split from restore.ts (line cap); restore-proving verification, which
 * actually restores the dump into a sandbox, lives in verify-restore.ts.
 */
import type { BackupId } from "@otterdeploy/shared/id";

import { getExecutionContext } from "./db";
import { openRepo } from "./restore";

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
