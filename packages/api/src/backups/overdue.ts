/**
 * Backup-overdue detection: notify when a schedule's newest SUCCESSFUL run is
 * older than its expected cadence. This is the alert neither "run succeeded"
 * nor "run failed" can carry: a scheduler that never fires (bad cron, wedged
 * process, every run failing) produces no outcome events at all, and the
 * operator's first sign is the restore that has nothing to restore.
 *
 * Threshold: `overdueAfterHours` when set; otherwise derived from the cron
 * cadence (2× the fire interval, floored at 1h) so alerts work with zero
 * configuration. One notification per overdue episode (`overdueNotifiedAt`
 * dedupes; a later success clears it, see updateScheduleAfterRun).
 */
import { Result } from "better-result";
import { log } from "evlog";

import type { OverdueCandidate } from "./schedule-db";

import { cronIntervalMs } from "../lib/cron";
import { emitPlatformEvent } from "../notifications/emit";
import { listOverdueCandidates, markScheduleOverdueNotified } from "./schedule-db";

const HOUR_MS = 3_600_000;

/** The overdue threshold in ms for a schedule (pure, unit-testable). */
export function overdueThresholdMs(
  candidate: Pick<OverdueCandidate, "cron" | "overdueAfterHours">,
  now: Date,
): number {
  if (candidate.overdueAfterHours != null && candidate.overdueAfterHours > 0) {
    return candidate.overdueAfterHours * HOUR_MS;
  }
  const interval = cronIntervalMs(candidate.cron, now);
  // Unparseable cron: fall back to a day so the schedule still alerts rather
  // than silently never qualifying (an unparseable cron IS an overdue cause).
  if (interval == null) return 24 * HOUR_MS;
  return Math.max(HOUR_MS, interval * 2);
}

/** Whether the candidate is overdue and un-notified (pure, unit-testable). */
export function isOverdue(candidate: OverdueCandidate, now: Date): boolean {
  if (candidate.overdueNotifiedAt != null) return false;
  const baseline = candidate.lastSuccessAt ?? candidate.createdAt;
  return now.getTime() - baseline.getTime() > overdueThresholdMs(candidate, now);
}

/** One sweep over the org's enabled schedules. Called on a slow cadence from
 *  the scheduler tick; failures log and never propagate. */
export async function sweepOverdueSchedules(now = new Date()): Promise<void> {
  const listed = await Result.tryPromise({
    try: () => listOverdueCandidates(),
    catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
  });
  if (listed.isErr()) {
    log.error({ backups: { overdue: "list-failed" }, error: listed.error.message });
    return;
  }

  for (const candidate of listed.value) {
    if (!isOverdue(candidate, now)) continue;
    const since = candidate.lastSuccessAt ?? candidate.createdAt;
    const hours = Math.round((now.getTime() - since.getTime()) / HOUR_MS);
    const notified = await Result.tryPromise({
      try: async () => {
        await emitPlatformEvent({
          organizationId: candidate.organizationId,
          eventId: "backup.overdue",
          title: "Backups are overdue",
          message: candidate.lastSuccessAt
            ? `Schedule "${candidate.name}" has had no successful backup in ~${hours}h.`
            : `Schedule "${candidate.name}" has never produced a successful backup (created ~${hours}h ago).`,
          data: { scheduleId: candidate.id, schedule: candidate.name },
        });
        await markScheduleOverdueNotified(candidate.id, now);
      },
      catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
    });
    if (notified.isErr()) {
      log.error({
        backups: { overdue: "notify-failed", schedule: candidate.id },
        error: notified.error.message,
      });
    }
  }
}
