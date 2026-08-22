import { db } from "@otterdeploy/db";
import {
  auditLog,
  deployment,
  deploymentLog,
  notification,
  platformMetric,
  resourceMetric,
  serverMetric,
} from "@otterdeploy/db/schema";
import { session, verification } from "@otterdeploy/db/schema/auth";
import { and, inArray, isNotNull, lt } from "drizzle-orm";
import * as z from "zod";

import { defineJob } from "../define";

// Retention windows.
const AUDIT_RETENTION_DAYS = 90;
const READ_NOTIFICATION_RETENTION_DAYS = 30;
// Live-dashboard feed, not long-term observability. Keep it short.
const METRIC_RETENTION_DAYS = 7;
// Build/deploy output for past deployments. The deployment row itself is kept
// (it's the history the UI lists); only its log lines age out.
const DEPLOYMENT_LOG_RETENTION_DAYS = 30;

/**
 * Deployments per DELETE when pruning their logs.
 *
 * A single build writes hundreds to thousands of lines, and this sweep runs for
 * the first time against a table that has never been pruned, so the first pass
 * has years of backlog to clear. Chunking keeps any one statement's transaction
 * and WAL bounded instead of attempting a multi-million-row delete in one go.
 */
const DEPLOYMENT_CHUNK = 25;

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

    // 1. Expired auth sessions: better-auth never garbage-collects these.
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

    // 6. Aged-out install-wide metric samples. platform_metric's schema comment
    //    has always claimed this sweep pruned it; it never did, so the table
    //    grew unbounded at 3 rows / 30s tick (~3.2M rows/year).
    const prunedPlatformMetrics = await db
      .delete(platformMetric)
      .where(lt(platformMetric.ts, daysAgo(METRIC_RETENTION_DAYS)))
      .returning({ seq: platformMetric.seq });

    // 7. Aged-out per-node host metric samples. Same window and same reason
    //    as the other two metric tables: this is the chart feed behind the
    //    per-server history, not long-term observability. The latest snapshot
    //    per server lives in server_health_sample and is never pruned (it is
    //    upserted in place, so it cannot grow).
    const prunedServerMetrics = await db
      .delete(serverMetric)
      .where(lt(serverMetric.ts, daysAgo(METRIC_RETENTION_DAYS)))
      .returning({ seq: serverMetric.seq });

    // 8. Build/deploy log lines for deployments past the retention window.
    //    Nothing pruned these before, and they are the highest-line-volume
    //    writer in the product: one row per line of every build ever run.
    //
    //    Selected by deployment rather than by `deployment_log.ts` on purpose:
    //    the log table's only index is (deployment_id, seq), so an id-keyed
    //    delete is an index scan, while a `ts <` predicate would sequentially
    //    scan the whole table on every pass. Including the steady-state pass
    //    that finds nothing left to do.
    const agedDeployments = await db
      .select({ id: deployment.id })
      .from(deployment)
      .where(lt(deployment.createdAt, daysAgo(DEPLOYMENT_LOG_RETENTION_DAYS)));

    let prunedDeploymentLogs = 0;
    for (let i = 0; i < agedDeployments.length; i += DEPLOYMENT_CHUNK) {
      const chunk = agedDeployments.slice(i, i + DEPLOYMENT_CHUNK).map((d) => d.id);
      const deleted = await db
        .delete(deploymentLog)
        .where(inArray(deploymentLog.deploymentId, chunk))
        .returning({ seq: deploymentLog.seq });
      prunedDeploymentLogs += deleted.length;
    }

    const summary = {
      sessions: expiredSessions.length,
      verifications: expiredVerifications.length,
      auditRows: prunedAudit.length,
      notifications: prunedNotifications.length,
      metrics: prunedMetrics.length,
      platformMetrics: prunedPlatformMetrics.length,
      serverMetrics: prunedServerMetrics.length,
      deploymentLogs: prunedDeploymentLogs,
    };
    log.info({ cleanup: { step: "done", ...summary } });

    return {
      cleaned: true,
      ...summary,
      timestamp: now.toISOString(),
    };
  },
});
