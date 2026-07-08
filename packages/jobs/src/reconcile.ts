import type { db as DbClient } from "@otterdeploy/db";

import { deployment, deploymentLog, project, resource } from "@otterdeploy/db/schema";
/**
 * Boot-time deploy reconciliation.
 *
 * A crash (or hard restart) of the builder can strand deployment rows in a
 * transient state: `pending` rows whose `deploy.triggered` job never started,
 * or `building` rows whose worker died mid-build. BullMQ's own stalled-job
 * handling re-runs the *job* but never touches our DB rows, so those rows would
 * sit "building" forever and the UI's Deployments tab would never settle.
 *
 * On builder boot we run two passes, guarded so only one process does the work:
 *
 *   Pass A — orphan detection. Scan the `deploy.triggered` queue for every job
 *   still in flight (waiting/active/delayed/paused) and union the
 *   `deploymentIds` they own. Any `pending`/`building` row NOT owned by a live
 *   job is an orphan from a crashed run → mark it `failed`. The
 *   `status IN ('pending','building')` guard in the UPDATE's WHERE clause makes
 *   this safe against a concurrent worker that picks the row up first.
 *
 *   Pass B — duplicate `running` collapse. If a crash left two `running`
 *   deployments for the same resource, keep the newest and `supersede` the rest.
 *
 * Each reset row gets a best-effort `deploy.failed` platform event (via the
 * in-package trigger — importing @otterdeploy/api would invert the dependency),
 * a `system` deployment-log line, and a warn evlog line. Notifications are
 * fire-and-forget: they must never throw out of reconcile.
 */
import { and, desc, eq, inArray } from "drizzle-orm";
import { log as globalLog } from "evlog";

import type { PlatformEventPayload } from "./jobs/notification-event";
import type { getQueue as GetQueueFn } from "./queues";

import { deployTriggeredJob } from "./jobs/deploy";

const LOCK_KEY = "otterdeploy:reconcile:deploy:lock";
const LOCK_TTL_MS = 60_000;

const INTERRUPTED_MESSAGE =
  "Interrupted by restart — the build process exited before this deployment finished.";

/** The handful of `db` methods reconcile touches — narrowed so tests can pass a
 *  hand-rolled mock without dragging in the full drizzle type surface. */
type DbLike = Pick<typeof DbClient, "select" | "update" | "insert">;
type GetQueueLike = typeof GetQueueFn;

export interface ReconcileOptions {
  db?: DbLike;
  getQueue?: GetQueueLike;
  /** Emit deploy.failed notifications for each reset row. Default true. */
  emit?: boolean;
  /** Override the run-once lock — defaults to a Redis SET NX PX on the shared
   *  connection. Tests inject this to exercise the not-acquired branch without
   *  Redis. Returns a release fn, or null when the lock is already held. */
  acquireLock?: () => Promise<(() => Promise<void>) | null>;
  /** Override the platform-event emitter. Defaults to the in-package
   *  triggerPlatformEvent (lazy-imported so reconcile's import graph doesn't
   *  drag in the notification/email delivery stack). */
  emitEvent?: (payload: PlatformEventPayload) => Promise<unknown>;
}

export interface ReconcileSummary {
  acquired: boolean;
  failed: number;
  superseded: number;
}

// ─── Redis run-once lock ─────────────────────────────────────────────────

/** Default lock: SET key token NX PX ttl via Bun's built-in Redis client.
 *  Returns a release fn (best-effort compare-and-DEL) or null when another
 *  process holds it. Raw `send()` is used so we can pass the NX/PX flags and
 *  run the release Lua — Bun's typed `.set()` doesn't expose them. */
async function defaultAcquireLock(): Promise<(() => Promise<void>) | null> {
  // Imported lazily so that pulling in the reconcile module (e.g. in unit
  // tests with an injected lock) doesn't require the Redis env.
  const { RedisClient } = await import("bun");
  const { env } = await import("@otterdeploy/env/server");
  const client = new RedisClient(env.REDIS_URL);
  const token = `${process.pid}:${Date.now()}`;
  const res = await client.send("SET", [LOCK_KEY, token, "PX", String(LOCK_TTL_MS), "NX"]);
  if (res !== "OK") {
    client.close();
    return null;
  }
  return async () => {
    // Only release if we still own the token, then close the client.
    await client
      .send("EVAL", [
        "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
        "1",
        LOCK_KEY,
        token,
      ])
      .catch(() => undefined);
    client.close();
  };
}

// ─── Reconcile ───────────────────────────────────────────────────────────

export async function reconcileInterruptedDeployments(
  opts: ReconcileOptions = {},
): Promise<ReconcileSummary> {
  // Real db/queue are lazy-imported so a caller that injects both (e.g. unit
  // tests) never loads the @otterdeploy/db client or the job registry, both of
  // which validate env / pull in the notification+email stack at module load.
  const db = opts.db ?? (await import("@otterdeploy/db")).db;
  const getQueue = opts.getQueue ?? (await import("./queues")).getQueue;
  const emit = opts.emit ?? true;
  const acquireLock = opts.acquireLock ?? defaultAcquireLock;
  const emitEvent =
    opts.emitEvent ??
    (async (payload: PlatformEventPayload) => {
      const { triggerPlatformEvent } = await import("./triggers");
      return triggerPlatformEvent(payload);
    });

  const release = await acquireLock();
  if (!release) {
    globalLog.info({
      reconcile: { event: "skipped", reason: "lock-held", key: LOCK_KEY },
    });
    return { acquired: false, failed: 0, superseded: 0 };
  }

  try {
    const failed = await reconcileOrphans(db, getQueue, emit, emitEvent);
    const superseded = await reconcileDuplicateRunning(db);
    globalLog.info({
      reconcile: { event: "done", failed, superseded },
    });
    return { acquired: true, failed, superseded };
  } finally {
    await release().catch(() => undefined);
  }
}

// ─── Pass A: orphaned pending/building rows ──────────────────────────────

async function reconcileOrphans(
  db: DbLike,
  getQueue: GetQueueLike,
  emit: boolean,
  emitEvent: (payload: PlatformEventPayload) => Promise<unknown>,
): Promise<number> {
  const candidates = await db
    .select({ id: deployment.id, resourceId: deployment.resourceId })
    .from(deployment)
    .where(inArray(deployment.status, ["pending", "building"]));

  if (candidates.length === 0) return 0;

  // Union every deploymentId still owned by an in-flight deploy.triggered job.
  const owned = new Set<string>();
  const queue = getQueue(deployTriggeredJob.name);
  const jobs = await queue.getJobs(["waiting", "active", "delayed", "paused"]);
  for (const job of jobs) {
    const ids = (job?.data as { deploymentIds?: string[] } | undefined)?.deploymentIds;
    if (Array.isArray(ids)) for (const id of ids) owned.add(id);
  }

  let count = 0;
  for (const row of candidates) {
    if (owned.has(row.id)) continue;

    // The inArray guard is the concurrency fence: a worker that grabbed the
    // row first (flipping it to running/failed) makes this UPDATE a no-op.
    const updated = await db
      .update(deployment)
      .set({
        status: "failed",
        errorMessage: INTERRUPTED_MESSAGE,
        completedAt: new Date(),
      })
      .where(and(eq(deployment.id, row.id), inArray(deployment.status, ["pending", "building"])))
      .returning({ id: deployment.id });

    if (updated.length === 0) continue;
    count++;

    await recordReset(db, row.id, INTERRUPTED_MESSAGE, emit, emitEvent);
  }

  return count;
}

// ─── Pass B: duplicate running rows per resource ─────────────────────────

async function reconcileDuplicateRunning(db: DbLike): Promise<number> {
  const rows = await db
    .select({
      id: deployment.id,
      resourceId: deployment.resourceId,
      previewId: deployment.previewId,
    })
    .from(deployment)
    .where(eq(deployment.status, "running"))
    .orderBy(deployment.resourceId, desc(deployment.createdAt));

  // Keep the newest per (resourceId, previewId) — a running PR preview and
  // the base deployment of the same service are BOTH legitimately running,
  // and two different PRs' previews are too. Keying on resourceId alone made
  // a fresh preview supersede production's running row.
  const seen = new Set<string>();
  let count = 0;
  for (const row of rows) {
    const key = `${row.resourceId}:${row.previewId ?? "base"}`;
    if (!seen.has(key)) {
      seen.add(key);
      continue;
    }
    const updated = await db
      .update(deployment)
      .set({ status: "superseded" })
      .where(and(eq(deployment.id, row.id), eq(deployment.status, "running")))
      .returning({ id: deployment.id });
    if (updated.length > 0) count++;
  }

  return count;
}

// ─── Side effects for a reset row ────────────────────────────────────────

/** Append a system log line + warn evlog + best-effort deploy.failed event.
 *  Notifications/logs are swallowed so a downstream failure never aborts the
 *  reconcile (which has already committed the status flip). */
async function recordReset(
  db: DbLike,
  deploymentId: string,
  message: string,
  emit: boolean,
  emitEvent: (payload: PlatformEventPayload) => Promise<unknown>,
): Promise<void> {
  globalLog.warn({
    reconcile: { event: "reset", deploymentId, reason: "interrupted-by-restart" },
  });

  await db
    .insert(deploymentLog)
    .values({
      deploymentId: deploymentId as never,
      stream: "system",
      line: `interrupted by restart — marked failed (${message})`,
    })
    .catch(() => undefined);

  if (!emit) return;

  // Resolve org/resource/project names the same way markDeploymentFailed does,
  // so the channel message reads identically. Best-effort throughout.
  await notifyDeployFailed(db, deploymentId, message, emitEvent).catch(() => undefined);
}

async function notifyDeployFailed(
  db: DbLike,
  deploymentId: string,
  message: string,
  emitEvent: (payload: PlatformEventPayload) => Promise<unknown>,
): Promise<void> {
  const [info] = await db
    .select({
      organizationId: project.organizationId,
      resourceName: resource.name,
      projectName: project.name,
    })
    .from(deployment)
    .innerJoin(resource, eq(resource.id, deployment.resourceId))
    .innerJoin(project, eq(project.id, resource.projectId))
    .where(eq(deployment.id, deploymentId as never));

  if (!info) return;

  await emitEvent({
    organizationId: info.organizationId,
    eventId: "deploy.failed",
    severity: "err",
    title: "Deploy failed",
    message: `${info.resourceName}: ${message}`,
    data: {
      deploymentId,
      resource: info.resourceName,
      project: info.projectName,
    },
  });
}
