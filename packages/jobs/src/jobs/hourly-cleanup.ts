import { db } from "@otterdeploy/db";
import { auditLog, notification, resourceMetric } from "@otterdeploy/db/schema";
import { session, verification } from "@otterdeploy/db/schema/auth";
import { and, isNotNull, lt } from "drizzle-orm";
import * as z from "zod";

import { defineJob } from "../define";

// Retention windows.
const AUDIT_RETENTION_DAYS = 90;
const READ_NOTIFICATION_RETENTION_DAYS = 30;
// Live-dashboard feed, not long-term observability — keep it short.
const METRIC_RETENTION_DAYS = 7;

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

export const hourlyCleanupJob = defineJob({
  name: "cron.hourly-cleanup",
  schema: z.object({}).optional().default({}),
  cron: { pattern: "0 * * * *" }, // every hour on the 0th minute
  opts: {
    removeOnComplete: { age: 60 * 60 * 24 * 3 },
    removeOnFail: { age: 60 * 60 * 24 * 14 },
  },
  async handler(_payload, { log }) {
    log.info({ cleanup: { step: "run" } });

    const now = new Date();

    // 1. Expired auth sessions — better-auth never garbage-collects these.
    const expiredSessions = await db
      .delete(session)
      .where(lt(session.expiresAt, now))
      .returning({ id: session.id });

    // 2. Expired verification tokens (email/OTP/device codes).
    const expiredVerifications = await db
      .delete(verification)
      .where(lt(verification.expiresAt, now))
      .returning({ id: verification.id });

    // 3. Aged-out audit rows beyond the retention window.
    const prunedAudit = await db
      .delete(auditLog)
      .where(lt(auditLog.timestamp, daysAgo(AUDIT_RETENTION_DAYS)))
      .returning({ id: auditLog.id });

    // 4. Read in-app notifications older than the retention window. Unread
    //    notifications are kept regardless of age.
    const prunedNotifications = await db
      .delete(notification)
      .where(
        and(
          isNotNull(notification.readAt),
          lt(notification.readAt, daysAgo(READ_NOTIFICATION_RETENTION_DAYS)),
        ),
      )
      .returning({ id: notification.id });

    // 5. Aged-out container metric samples.
    const prunedMetrics = await db
      .delete(resourceMetric)
      .where(lt(resourceMetric.ts, daysAgo(METRIC_RETENTION_DAYS)))
      .returning({ seq: resourceMetric.seq });

    const summary = {
      sessions: expiredSessions.length,
      verifications: expiredVerifications.length,
      auditRows: prunedAudit.length,
      notifications: prunedNotifications.length,
      metrics: prunedMetrics.length,
    };
    log.info({ cleanup: { step: "done", ...summary } });

    return {
      cleaned: true,
      ...summary,
      timestamp: now.toISOString(),
    };
  },
});
