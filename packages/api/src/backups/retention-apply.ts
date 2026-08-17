import { errorFromUnknown } from "@otterdeploy/shared/promise";
/**
 * Retention application for a schedule's snapshots, driven by the scheduler
 * after a successful pass. Two layers:
 *
 *   1. GFS keep-policy per repo: `rustic forget --keep-* --keep-within --prune`
 *      scoped by the schedule's tags. rustic decides which snapshots survive;
 *      the DB rows are then reconciled to that outcome.
 *   2. Byte ceiling (`maxStorageGb`): rustic has no native size cap, so the
 *      selection is computed in retention.ts (pure) over the surviving rows and
 *      executed as an explicit snapshot-level `forget <id>… --prune` per repo.
 *
 * Split out of scheduler.ts so the tick loop stays focused on cadence.
 */
import { Result } from "better-result";
import { log } from "evlog";

import type { ResolvedDestination } from "./backends";
import type { ForgetSpec } from "./rustic";
import type { DueSchedule } from "./schedule-db";

import { deriveRepoKey, toRusticRepo } from "./backends";
import { getExecutionContext } from "./db";
import { resolveSecret } from "./engine-helpers";
import { selectBackupsToPrune } from "./retention";
import { RusticCli } from "./rustic";
import { deleteBackupRow, listScheduleBackups } from "./schedule-db";

type ScheduleBackups = Awaited<ReturnType<typeof listScheduleBackups>>;

interface RepoGroup {
  cli: RusticCli;
  rows: ScheduleBackups;
}

/** Group a schedule's succeeded runs by their rustic repo. The group key
 *  includes the destination id because two destinations can derive the same
 *  repo id (e.g. two S3 buckets with no prefix) while being distinct repos. */
async function groupByRepo(rows: ScheduleBackups): Promise<Map<string, RepoGroup>> {
  const repos = new Map<string, RepoGroup>();
  for (const b of rows) {
    const ctx = await getExecutionContext(b.id);
    if (!ctx) continue;
    const repoKey = deriveRepoKey(ctx);
    const groupKey = `${ctx.destination.id}:${repoKey.repoId}`;
    let entry = repos.get(groupKey);
    if (!entry) {
      const secret = await resolveSecret(ctx);
      const dest: ResolvedDestination = {
        type: ctx.destination.type,
        config: ctx.destination.config,
        secret,
      };
      entry = { cli: new RusticCli(toRusticRepo(dest, repoKey)), rows: [] };
      repos.set(groupKey, entry);
    }
    entry.rows.push(b);
  }
  return repos;
}

/** Reconcile: drop any succeeded row whose snapshot no longer resolves. */
async function reconcileRows(cli: RusticCli, rows: ScheduleBackups): Promise<void> {
  for (const b of rows) {
    if (!b.storagePath) continue;
    const exists = await cli.snapshotExists(b.storagePath);
    if (!exists) await deleteBackupRow(b.id);
  }
}

/** Layer 2: enforce the schedule-wide byte ceiling at the snapshot level. */
async function applyStorageCap(
  schedule: DueSchedule,
  repos: Map<string, RepoGroup>,
): Promise<void> {
  if (schedule.maxStorageGb == null) return;
  // Survivors only (post-GFS), newest-first, as retention.ts expects.
  const survivors: ScheduleBackups = await listScheduleBackups(schedule.id);
  const toPrune = selectBackupsToPrune(survivors, { maxStorageGb: schedule.maxStorageGb });
  if (toPrune.length === 0) return;
  const pruneIds = new Set(toPrune.map((b) => b.id));

  for (const [groupKey, { cli, rows }] of repos) {
    const snapshotIds = rows
      .filter((b) => pruneIds.has(b.id) && b.storagePath != null)
      .map((b) => b.storagePath)
      .filter((s): s is string => s != null);
    if (snapshotIds.length === 0) continue;
    const applied = await Result.tryPromise({
      try: async () => {
        await cli.forgetSnapshots(snapshotIds);
        for (const b of rows) {
          if (pruneIds.has(b.id)) await deleteBackupRow(b.id);
        }
      },
      catch: errorFromUnknown,
    });
    if (applied.isErr()) {
      log.error({
        backups: { scheduler: schedule.id, repo: groupKey, status: "storage-cap-error" },
        error: applied.error.message,
      });
    }
  }
}

/** GFS + byte-ceiling retention for one schedule. Never throws: retention
 *  failure must not fail the schedule pass that produced good backups. */
export async function applyRetention(schedule: DueSchedule): Promise<void> {
  const all = await listScheduleBackups(schedule.id);
  if (all.length === 0) return;

  const repos = await groupByRepo(all);

  const spec: ForgetSpec = {
    keepLast: schedule.keepLast,
    keepHourly: schedule.keepHourly,
    keepDaily: schedule.keepDaily,
    keepWeekly: schedule.keepWeekly,
    keepMonthly: schedule.keepMonthly,
    keepYearly: schedule.keepYearly,
    keepWithinDays: schedule.retentionDays,
  };
  const filterTags = ["otterdeploy", `schedule:${schedule.id}`];

  for (const [groupKey, { cli, rows }] of repos) {
    const applied = await Result.tryPromise({
      try: async () => {
        await cli.forget(spec, filterTags);
        await reconcileRows(cli, rows);
      },
      catch: errorFromUnknown,
    });
    if (applied.isErr()) {
      log.error({
        backups: { scheduler: schedule.id, repo: groupKey, status: "retention-error" },
        error: applied.error.message,
      });
    }
  }

  await applyStorageCap(schedule, repos);
}
