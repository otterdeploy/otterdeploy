/**
 * Execute a batch of queued runs one after another.
 *
 * A run fans out into one record per destination (and, for a schedule, per
 * source). Every record of one source dumps the same database, and the engine
 * holds a single-in-flight lock per source (engine.ts claimBackupLock), so
 * starting them all at once made every destination after the first fail with
 * "another backup is already running". Running them in order keeps the lock
 * meaning what it says (two dumps of one database at once are never useful)
 * while every destination still gets its snapshot.
 */
import type { BackupId } from "@otterdeploy/shared/id";

import { errorFromUnknown } from "@otterdeploy/shared/promise";
import { Result } from "better-result";

import { markBackupFailed } from "./db";
import { executeBackup } from "./engine";

/**
 * Run `ids` sequentially; safe to fire detached (`void`). executeBackup
 * settles its own row; one that throws before it can (its context read
 * failing) is failed here so it never sits `queued`, and the rest still run.
 */
export async function executeBackupsInOrder(ids: readonly BackupId[]): Promise<void> {
  for (const id of ids) {
    const ran = await Result.tryPromise({ try: () => executeBackup(id), catch: errorFromUnknown });
    if (ran.isOk()) continue;
    await Result.tryPromise({
      try: () => markBackupFailed(id, `backup did not start: ${ran.error.message}`),
      catch: errorFromUnknown,
    });
  }
}
