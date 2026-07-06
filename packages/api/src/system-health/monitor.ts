/**
 * Host-health monitor — the background tick that turns introspection into
 * warnings the operator actually sees. Every interval it snapshots host
 * health, records memory/disk series onto `platform_metric` (history for the
 * UI), and pushes warning/critical recommendations through the platform
 * notification pipeline (in-app inbox + every subscribed Slack/Discord/email/
 * webhook channel) as `host.pressure` events.
 *
 * Cooldown: each recommendation id re-notifies at most once per window, so a
 * server sitting at 92% memory pings once, not every five minutes. In-memory
 * (mirrors notifications/audit-anomaly.ts) — a restart re-arming alerts is
 * acceptable, losing alerts is not.
 *
 * Started from apps/server alongside startMetricsSampler; same lifecycle.
 */
import type { OrganizationId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { platformMetric } from "@otterdeploy/db/schema";
import { organization } from "@otterdeploy/db/schema/auth";
import { Result } from "better-result";
import { log } from "evlog";

import { emitPlatformEvent } from "../notifications/emit";
import { getHostHealth, type HostHealth } from "./host-health";
import { reclaimSpace } from "./reclaim";
import { deriveRecommendations } from "./recommendations";

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;
const NOTIFY_COOLDOWN_MS = 6 * 60 * 60 * 1000;

// Self-heal: when the data root crosses this, auto-reclaim the SAFE targets
// (unused images + idle build cache) instead of only alerting — a full disk
// stalls every build/deploy, so waiting for an operator to click "reclaim" is
// too late. Only fires when there's a meaningful amount to reclaim, and at most
// once per window so it never churns.
const AUTO_RECLAIM_DISK_PCT = 88;
const AUTO_RECLAIM_MIN_BYTES = 1024 ** 3; // 1 GiB — don't churn for scraps
const AUTO_RECLAIM_COOLDOWN_MS = 30 * 60 * 1000;

const lastNotified = new Map<string, number>();

function underCooldown(id: string, now: number): boolean {
  const last = lastNotified.get(id);
  return last != null && now - last < NOTIFY_COOLDOWN_MS;
}

async function recordSeries(health: HostHealth): Promise<void> {
  const values = [{ metric: "host.mem.used_pct", value: health.memory.usedPct }];
  if (health.disk) values.push({ metric: "host.disk.used_pct", value: health.disk.usedPct });
  if (health.docker) {
    values.push({
      metric: "host.docker.reclaimable_bytes",
      value: health.docker.images.reclaimableBytes + health.docker.buildCache.reclaimableBytes,
    });
  }
  if (health.branchPool?.imagePhysicalBytes != null) {
    values.push({
      metric: "host.branchpool.physical_bytes",
      value: health.branchPool.imagePhysicalBytes,
    });
  }
  await db.insert(platformMetric).values(values);
}

async function notifyPressure(health: HostHealth): Promise<void> {
  const now = Date.now();
  // Only warning/critical interrupt people; info-level stays UI-only.
  const urgent = deriveRecommendations(
    health.memory,
    health.disk,
    health.docker,
    health.branchPool,
  ).filter((r) => r.severity !== "info" && !underCooldown(r.id, now));
  if (urgent.length === 0) return;

  // Instance-wide condition → every org on this install gets it; their
  // channel subscriptions decide where it lands.
  const orgs = await db.select({ id: organization.id }).from(organization);
  for (const rec of urgent) {
    lastNotified.set(rec.id, now);
    for (const org of orgs) {
      await emitPlatformEvent({
        organizationId: org.id as OrganizationId,
        eventId: "host.pressure",
        title: rec.title,
        message: rec.detail,
        data: { recommendation: rec.id, severity: rec.severity, action: rec.action },
      });
    }
  }
}

let lastAutoReclaimAt = 0;

/** Reclaim disk automatically when the data root is critically full, so a build
 *  host can't wedge itself at 100% (which stalls every build/deploy). Prunes
 *  only the SAFE targets the manual "reclaim" button uses — unused images and
 *  idle BuildKit cache, both re-created on demand. Best-effort; emits an
 *  info-level event so the operator sees the box healed itself. */
async function autoReclaim(health: HostHealth): Promise<void> {
  const disk = health.disk;
  if (!disk || disk.usedPct < AUTO_RECLAIM_DISK_PCT) return;
  const reclaimable =
    (health.docker?.images.reclaimableBytes ?? 0) +
    (health.docker?.buildCache.reclaimableBytes ?? 0);
  if (reclaimable < AUTO_RECLAIM_MIN_BYTES) return; // nothing worth reclaiming yet
  const now = Date.now();
  if (now - lastAutoReclaimAt < AUTO_RECLAIM_COOLDOWN_MS) return;
  lastAutoReclaimAt = now;

  const { reclaimedBytes } = await reclaimSpace(["images", "build-cache"]);
  log.info({ health: { step: "auto-reclaim", diskUsedPct: disk.usedPct, reclaimedBytes } });
  if (reclaimedBytes <= 0) return;

  const gb = (b: number) => `${(b / 1024 ** 3).toFixed(1)} GB`;
  const orgs = await db.select({ id: organization.id }).from(organization);
  for (const org of orgs) {
    await emitPlatformEvent({
      organizationId: org.id as OrganizationId,
      eventId: "host.pressure",
      title: `Auto-reclaimed ${gb(reclaimedBytes)} of disk`,
      message: `The data root was at ${disk.usedPct}% — otterdeploy pruned unused images and idle build cache so builds don't stall.`,
      data: { recommendation: "auto-reclaim", severity: "info", action: "images" },
    });
  }
}

async function tick(): Promise<void> {
  const ran = await Result.tryPromise({
    try: async () => {
      const health = await getHostHealth();
      await recordSeries(health);
      await notifyPressure(health);
      await autoReclaim(health);
    },
    catch: (cause) => cause,
  });
  if (ran.isErr()) {
    log.warn({ health: { step: "monitor-tick" }, err: ran.error });
  }
}

/** Start the monitor; returns a stop handle (same shape as the metrics
 *  sampler). The first tick runs shortly after boot so a fresh install shows
 *  history without waiting a full interval. */
export function startHostHealthMonitor(intervalMs = DEFAULT_INTERVAL_MS): () => void {
  const timer = setInterval(() => void tick(), intervalMs);
  timer.unref();
  const kickoff = setTimeout(() => void tick(), 10_000);
  kickoff.unref();
  return () => {
    clearInterval(timer);
    clearTimeout(kickoff);
  };
}
