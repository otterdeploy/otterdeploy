/**
 * Backup schedule scanner + retention. Runs on a fixed control-plane tick
 * (started from the server bootstrap) rather than a BullMQ repeatable so user
 * edits to cron/retention take effect immediately — the DB is the source of
 * truth (see backup.ts schema notes). Each tick:
 *   1. finds enabled schedules due now (nextRunAt null or past)
 *   2. for each source DB, creates + executes a backup run
 *   3. computes the next fire time from the cron expression
 *   4. applies the retention policy (prune old archives + rows)
 */
import { parseExpression } from "cron-parser";
import { log } from "evlog";

import type { ResolvedDestination } from "./backends";

import { deriveRepoId, toRusticRepo } from "./backends";
import { createBackupRun, getExecutionContext } from "./db";
import { executeBackup } from "./engine";
import { resolveSecret } from "./engine-helpers";
import { type ForgetSpec, RusticCli } from "./rustic";
import {
  type DueSchedule,
  deleteBackupRow,
  listDueSchedules,
  listScheduleBackups,
  resolveScheduleSources,
  updateScheduleAfterRun,
} from "./schedule-db";

function nextFireTime(cron: string, from: Date): Date | null {
  try {
    const it = parseExpression(cron, { currentDate: from });
    return it.next().toDate();
  } catch {
    return null;
  }
}

let running = false;

/** One scan pass. Safe to call repeatedly; self-guards against overlap. */
export async function runDueBackupSchedules(now = new Date()): Promise<void> {
  if (running) return;
  running = true;
  try {
    const due = await listDueSchedules(now);
    for (const schedule of due) {
      await runSchedule(schedule, now).catch((cause) => {
        log.error({
          backups: { scheduler: schedule.id, status: "error" },
          error: cause instanceof Error ? cause.message : String(cause),
        });
      });
    }
  } finally {
    running = false;
  }
}

async function runSchedule(schedule: DueSchedule, now: Date): Promise<void> {
  // A null nextRunAt means the schedule was just created — only initialize its
  // fire time, don't backfill a run. Otherwise it's genuinely due.
  if (schedule.nextRunAt == null) {
    await updateScheduleAfterRun(schedule.id, {
      lastRunAt: now,
      lastRunStatus: "queued",
      nextRunAt: nextFireTime(schedule.cron, now),
    });
    return;
  }

  const resourceIds = await resolveScheduleSources(schedule.organizationId, schedule.sources);

  // A due schedule that resolves to no runnable (source × destination) pair is
  // orphaned or misconfigured — record `failed`, not the benign `queued`
  // placeholder that made a broken schedule look perpetually about-to-run.
  let lastStatus: "succeeded" | "failed" = "failed";
  if (resourceIds.length > 0 && schedule.destinationIds.length > 0) {
    // One dump per (source × destination) — each is its own single-destination
    // backup record, so the engine, restore, and retention stay unchanged.
    for (const resourceId of resourceIds) {
      for (const destinationId of schedule.destinationIds) {
        const backupId = await createBackupRun({
          organizationId: schedule.organizationId,
          source: { kind: "database", resourceId },
          destinationId,
          scheduleId: schedule.id,
          encryption: schedule.encryption === "aes-256-gcm" ? "aes-256-gcm" : "none",
          method: "scheduled",
        });
        await executeBackup(backupId);
      }
    }
    lastStatus = "succeeded";
    await applyRetention(schedule);
  }

  await updateScheduleAfterRun(schedule.id, {
    lastRunAt: now,
    lastRunStatus: lastStatus,
    nextRunAt: nextFireTime(schedule.cron, now),
  });
}

/** GFS retention, delegated to rustic. Each (resource × destination) is its own
 *  rustic repo, so we group the schedule's snapshots by repo and run one
 *  `forget --prune` per repo with the GFS keep flags + max-age (keep-within).
 *  rustic owns which snapshots survive; we then reconcile the DB rows to that
 *  outcome — dropping any succeeded row whose snapshot `forget` pruned — so
 *  usage totals + history stay honest.
 *
 *  Note: `maxStorageGb` has no native rustic flag and can't be enforced at the
 *  snapshot level via `forget` (which takes a keep policy, not explicit ids), so
 *  it is NOT applied here; the residual selection lives in retention.ts pending a
 *  snapshot-level forget. */
async function applyRetention(schedule: DueSchedule): Promise<void> {
  const all = await listScheduleBackups(schedule.id);
  if (all.length === 0) return;

  // Group snapshots by their rustic repo (one repo per resource × destination).
  // Each run's execution context yields the repo id + backend creds we need to
  // build a driver; snapshots for the same repo share one `forget` pass.
  const repos = new Map<string, { cli: RusticCli; rows: typeof all }>();
  for (const b of all) {
    const ctx = await getExecutionContext(b.id);
    if (!ctx) continue;
    const repoId = deriveRepoId(ctx);
    let entry = repos.get(repoId);
    if (!entry) {
      const secret = await resolveSecret(ctx);
      const dest: ResolvedDestination = {
        type: ctx.destination.type,
        config: ctx.destination.config,
        secret,
      };
      entry = { cli: new RusticCli(toRusticRepo(dest, repoId)), rows: [] };
      repos.set(repoId, entry);
    }
    entry.rows.push(b);
  }

  // GFS tiers → rustic `--keep-*`; the hard max age → `--keep-within <N>d`.
  const spec: ForgetSpec = {
    keepDaily: schedule.keepDaily,
    keepWeekly: schedule.keepWeekly,
    keepMonthly: schedule.keepMonthly,
    keepYearly: schedule.keepYearly,
    keepWithinDays: schedule.retentionDays,
  };
  const filterTags = ["otterdeploy", `schedule:${schedule.id}`];

  for (const [repoId, { cli, rows }] of repos) {
    try {
      await cli.forget(spec, filterTags);
      // Reconcile: drop any succeeded row whose snapshot `forget` just pruned.
      for (const b of rows) {
        if (!b.storagePath) continue;
        const exists = await cli.snapshotExists(b.storagePath);
        if (!exists) await deleteBackupRow(b.id);
      }
    } catch (cause) {
      log.error({
        backups: { scheduler: schedule.id, repo: repoId, status: "retention-error" },
        error: cause instanceof Error ? cause.message : String(cause),
      });
    }
  }
}

/** Start the periodic scanner. Returns a stop handle. */
export function startBackupScheduler(intervalMs = 60_000): () => void {
  const timer = setInterval(() => {
    void runDueBackupSchedules();
  }, intervalMs);
  // Don't keep the event loop alive solely for backups.
  timer.unref?.();
  return () => clearInterval(timer);
}
