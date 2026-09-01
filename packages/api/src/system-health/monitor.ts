import type { RedisClient } from "bun";

import { db } from "@otterdeploy/db";
import { platformMetric } from "@otterdeploy/db/schema";
import { organization } from "@otterdeploy/db/schema/auth";
/**
 * Host-health monitor: the background tick that turns introspection into
 * warnings the operator actually sees. Every interval it snapshots host
 * health, records memory/disk series onto `platform_metric` (history for the
 * UI), and pushes warning/critical recommendations through the platform
 * notification pipeline (in-app inbox + every subscribed Slack/Discord/email/
 * webhook channel) as `host.pressure` events.
 *
 * Notifications are TRANSITIONS, not ticks. A recommendation is announced
 * when it first appears, reminded after a long window if it is still true,
 * and announced as cleared (`host.pressure.cleared`) when it stops being
 * true. The active set lives in Redis, not in this process: the old
 * in-memory cooldown forgot everything on restart, so a box sitting at 92%
 * memory produced one more unread row per restart, and in dev one per `--hot`
 * reload. The owner's inbox held seventy of them. Redis unavailable degrades
 * to a process-local copy, which is the old behaviour, never silence.
 *
 * Started from apps/server alongside startMetricsSampler; same lifecycle.
 */
import { hasPrefix, ID_PREFIX, type OrganizationId } from "@otterdeploy/shared/id";
import { type InboxSubject } from "@otterdeploy/shared/inbox-subject";
import { Result } from "better-result";
import { log } from "evlog";

import { createRedis } from "../lib/redis";
import { emitPlatformEvent } from "../notifications/emit";
import { getHostHealth, type HostHealth } from "./host-health";
import { hostHostname } from "./host-identity";
import {
  type ActivePressure,
  activePressureSchema,
  clearedTitle,
  planPressureTransitions,
} from "./pressure-transitions";
import { reclaimSpace } from "./reclaim";
import { deriveRecommendations } from "./recommendations";

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;
/** A still-true condition is re-announced after this long, so a warning nobody
 *  acted on resurfaces once a shift, not once a tick. */
const REMIND_AFTER_MS = 6 * 60 * 60 * 1000;
const ACTIVE_KEY = "otterdeploy:host-pressure:active";

// Self-heal: when the data root crosses this, auto-reclaim the SAFE targets
// (unused images + idle build cache) instead of only alerting. A full disk
// stalls every build/deploy, so waiting for an operator to click "reclaim" is
// too late. Only fires when there's a meaningful amount to reclaim, and at most
// once per window so it never churns.
const AUTO_RECLAIM_DISK_PCT = 88;
const AUTO_RECLAIM_MIN_BYTES = 1024 ** 3; // 1 GiB: don't churn for scraps
const AUTO_RECLAIM_COOLDOWN_MS = 30 * 60 * 1000;

let redis: RedisClient | null = null;
function redisClient(): RedisClient {
  redis ??= createRedis();
  return redis;
}

/** Process-local mirror of the persisted set: what we fall back to when Redis
 *  cannot be read, and what we write through on every save. */
let activeFallback: ActivePressure = {};

async function loadActive(): Promise<ActivePressure> {
  const loaded = await Result.tryPromise({
    try: async () => {
      const raw = await redisClient().get(ACTIVE_KEY);
      return raw === null ? {} : activePressureSchema.parse(JSON.parse(raw));
    },
    catch: (cause) => cause,
  });
  if (loaded.isErr()) {
    log.warn({ health: { step: "pressure-state-load" }, err: loaded.error });
    return activeFallback;
  }
  return loaded.value;
}

async function saveActive(next: ActivePressure): Promise<void> {
  activeFallback = next;
  const saved = await Result.tryPromise({
    try: () => redisClient().set(ACTIVE_KEY, JSON.stringify(next)),
    catch: (cause) => cause,
  });
  if (saved.isErr()) log.warn({ health: { step: "pressure-state-save" }, err: saved.error });
}

/** This host, as the thing every pressure event is about. */
function hostSubject(): InboxSubject {
  const name = hostHostname();
  return { kind: "server", id: name, label: name };
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

/** Every org on this install, branded. The auth table stores plain text ids,
 *  so the brand comes from the runtime prefix check rather than an assertion. */
async function listOrganizationIds(): Promise<OrganizationId[]> {
  const rows = await db.select({ id: organization.id }).from(organization);
  return rows
    .map((row) => row.id)
    .filter((id): id is OrganizationId => hasPrefix(id, ID_PREFIX.organization));
}

async function notifyPressure(health: HostHealth): Promise<void> {
  const now = Date.now();
  // Only warning/critical interrupt people; info-level stays UI-only.
  const urgent = deriveRecommendations(
    health.memory,
    health.disk,
    health.docker,
    health.branchPool,
  ).filter((r) => r.severity !== "info");
  const active = await loadActive();
  const plan = planPressureTransitions({ active, urgent, now, remindAfterMs: REMIND_AFTER_MS });
  if (plan.notify.length === 0 && plan.clear.length === 0) return;

  // Instance-wide condition → every org on this install gets it; their
  // channel subscriptions decide where it lands.
  const orgIds = await listOrganizationIds();
  const subject = hostSubject();
  for (const rec of plan.notify) {
    for (const organizationId of orgIds) {
      await emitPlatformEvent({
        organizationId,
        eventId: "host.pressure",
        title: rec.title,
        message: rec.detail,
        subject,
        data: { recommendation: rec.id, severity: rec.severity, action: rec.action ?? "" },
      });
    }
  }
  for (const cleared of plan.clear) {
    for (const organizationId of orgIds) {
      await emitPlatformEvent({
        organizationId,
        eventId: "host.pressure.cleared",
        title: clearedTitle(cleared.id, cleared.title),
        message: `${subject.label} is no longer reporting: ${cleared.title.toLowerCase()}.`,
        subject,
        data: { recommendation: cleared.id, severity: "info", action: "" },
      });
    }
  }
  // Saved after the emits: a crash in between re-announces once, which the
  // inbox folds; the reverse order could lose a clear for good.
  await saveActive(plan.next);
}

let lastAutoReclaimAt = 0;

/** Reclaim disk automatically when the data root is critically full, so a build
 *  host can't wedge itself at 100% (which stalls every build/deploy). Prunes
 *  only the SAFE targets the manual "reclaim" button uses. Unused images and
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
  const orgIds = await listOrganizationIds();
  for (const organizationId of orgIds) {
    await emitPlatformEvent({
      organizationId,
      eventId: "host.pressure",
      title: `Auto-reclaimed ${gb(reclaimedBytes)} of disk`,
      message: `The data root was at ${disk.usedPct}%. Otterdeploy pruned unused images and idle build cache so builds don't stall.`,
      subject: hostSubject(),
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
