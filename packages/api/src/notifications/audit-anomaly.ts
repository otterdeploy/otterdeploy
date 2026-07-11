import type { OrganizationId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { auditLog } from "@otterdeploy/db/schema";
/**
 * Audit-anomaly detector — a periodic, conservative scan over recent `audit_log`
 * rows that emits `audit.anomaly` on a small, high-signal rule set. Runs on a
 * control-plane tick from the server bootstrap (like the backup scheduler /
 * data-folder sweep); `unref`'d and best-effort, so it never keeps the loop
 * alive or breaks anything.
 *
 * Rules (deliberately few — noisy heuristics erode trust in the alert):
 *   A. Denial burst — ≥ DENIAL_THRESHOLD failed/denied actions from ONE ip
 *      within an org in the window (RBAC denials + auth failures are audited:
 *      a sign of probing / brute force / a misconfigured client).
 *   B. Deletion burst — ≥ DELETE_THRESHOLD successful `*.delete` actions by ONE
 *      actor within the window (a sign of mass teardown — accidental or hostile).
 *
 * De-dup: an in-memory cooldown keyed by (rule, org, subject) suppresses
 * re-emitting the same anomaly within the window. In-memory by design (no
 * schema); a restart at worst re-alerts an active burst once.
 */
import { and, eq, gte, inArray, isNotNull, like, sql } from "drizzle-orm";
import { log } from "evlog";

import { emitPlatformEvent } from "./emit";

const WINDOW_MS = 10 * 60 * 1000; // look back 10 minutes
const DENIAL_THRESHOLD = 10; // failed/denied from one ip
const DELETE_THRESHOLD = 8; // successful deletes by one actor

/** key → last-emitted ms. Suppresses repeat alerts within the window. */
const cooldown = new Map<string, number>();

function claim(key: string, now: number): boolean {
  const last = cooldown.get(key);
  if (last !== undefined && now - last < WINDOW_MS) return false;
  cooldown.set(key, now);
  return true;
}

/** Drop cooldown entries older than the window so the map can't grow without
 *  bound on a long-lived control plane. */
function pruneCooldown(now: number): void {
  for (const [key, ts] of cooldown) {
    if (now - ts >= WINDOW_MS) cooldown.delete(key);
  }
}

async function emitAnomaly(
  organizationId: string,
  title: string,
  message: string,
  data: Record<string, string>,
): Promise<void> {
  await emitPlatformEvent({
    organizationId: organizationId as OrganizationId,
    eventId: "audit.anomaly",
    title,
    message,
    data,
  }).catch(() => undefined);
}

/** One scan pass. Never throws. */
export async function scanAuditAnomalies(now = Date.now()): Promise<void> {
  try {
    const since = new Date(now - WINDOW_MS);

    // Rule A — denial/failure burst from one ip within an org.
    const denials = await db
      .select({
        organizationId: auditLog.organizationId,
        ip: auditLog.ip,
        count: sql<number>`count(*)::int`,
      })
      .from(auditLog)
      .where(
        and(
          gte(auditLog.timestamp, since),
          inArray(auditLog.outcome, ["failure", "denied"]),
          isNotNull(auditLog.organizationId),
          isNotNull(auditLog.ip),
        ),
      )
      .groupBy(auditLog.organizationId, auditLog.ip)
      .having(sql`count(*) >= ${DENIAL_THRESHOLD}`);

    for (const row of denials) {
      if (!row.organizationId || !row.ip) continue;
      if (!claim(`denial:${row.organizationId}:${row.ip}`, now)) continue;
      await emitAnomaly(
        row.organizationId,
        "Unusual access activity",
        `${row.count} denied or failed actions from ${row.ip} in the last 10 minutes`,
        { rule: "denial-burst", ip: row.ip, count: String(row.count) },
      );
    }

    // Rule B — destructive-op burst by one actor.
    const deletes = await db
      .select({
        organizationId: auditLog.organizationId,
        actorId: auditLog.actorId,
        actorLabel: auditLog.actorLabel,
        count: sql<number>`count(*)::int`,
      })
      .from(auditLog)
      .where(
        and(
          gte(auditLog.timestamp, since),
          eq(auditLog.outcome, "success"),
          like(auditLog.action, "%.delete"),
          isNotNull(auditLog.organizationId),
        ),
      )
      .groupBy(auditLog.organizationId, auditLog.actorId, auditLog.actorLabel)
      .having(sql`count(*) >= ${DELETE_THRESHOLD}`);

    for (const row of deletes) {
      if (!row.organizationId) continue;
      if (!claim(`delete:${row.organizationId}:${row.actorId}`, now)) continue;
      await emitAnomaly(
        row.organizationId,
        "Burst of deletions",
        `${row.actorLabel ?? row.actorId} deleted ${row.count} resources in the last 10 minutes`,
        { rule: "delete-burst", actorId: row.actorId, count: String(row.count) },
      );
    }

    pruneCooldown(now);
  } catch (cause) {
    log.warn({
      auditAnomaly: { event: "scan-failed" },
      error: cause instanceof Error ? cause.message : String(cause),
    } as Record<string, unknown>);
  }
}

/**
 * Start the periodic anomaly scan. Returns a stop handle. Scans every 5 min
 * (< the 10-min window) so a burst is caught promptly but only alerted once.
 */
export function startAuditAnomalyScan(intervalMs = 5 * 60 * 1000): () => void {
  const timer = setInterval(() => void scanAuditAnomalies(), intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
