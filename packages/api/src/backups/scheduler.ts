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

import { createBackupRun } from "./db";
import {
  type DueSchedule,
  deleteBackupRow,
  getDestinationByIdWithSecret,
  listDueSchedules,
  listScheduleBackups,
  resolveScheduleSources,
  updateScheduleAfterRun,
} from "./schedule-db";
import { executeBackup } from "./engine";
import { selectBackupsToPrune } from "./retention";
import { type ResolvedDestination, removeArchive } from "./storage";
import { decryptSecret } from "../lib/crypto";

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

  const resourceIds = await resolveScheduleSources(
    schedule.organizationId,
    schedule.sources,
  );

  let lastStatus: "succeeded" | "failed" | "queued" = "queued";
  if (resourceIds.length > 0) {
    for (const resourceId of resourceIds) {
      const backupId = await createBackupRun({
        organizationId: schedule.organizationId,
        resourceId,
        destinationId: schedule.destinationId,
        scheduleId: schedule.id,
        encryption:
          schedule.encryption === "aes-256-gcm" ? "aes-256-gcm" : "none",
        method: "scheduled",
      });
      await executeBackup(backupId);
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

/** GFS retention. Keeps the most recent archive per day/week/month/year up to
 *  each tier's count, enforces an optional hard max age and storage ceiling,
 *  then prunes the rest. Both the stored archive AND the row are removed so
 *  usage totals stay honest. */
async function applyRetention(schedule: DueSchedule): Promise<void> {
  const backups = await listScheduleBackups(schedule.id);
  const toPrune = selectBackupsToPrune(backups, {
    keepDaily: schedule.keepDaily,
    keepWeekly: schedule.keepWeekly,
    keepMonthly: schedule.keepMonthly,
    keepYearly: schedule.keepYearly,
    retentionDays: schedule.retentionDays,
    maxStorageGb: schedule.maxStorageGb,
  });
  if (toPrune.length === 0) return;

  const secret = await resolveDestinationSecret(schedule.destinationId);
  for (const b of toPrune) {
    if (b.storagePath && secret) {
      await removeArchive(secret, b.storagePath).catch(() => undefined);
    }
    await deleteBackupRow(b.id);
  }
}

async function resolveDestinationSecret(
  destinationId: DueSchedule["destinationId"],
): Promise<ResolvedDestination | null> {
  const row = await getDestinationByIdWithSecret(destinationId);
  if (!row) return null;
  const secret = row.encryptedSecret
    ? (JSON.parse(await decryptSecret(row.encryptedSecret)) as Record<
        string,
        string
      >)
    : {};
  return { type: row.type, config: row.config, secret };
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
