/**
 * Named deploy lanes: per-build-node queues.
 *
 * One global `deploy.triggered` queue means a slow build blocks every project
 * on the install. Lanes split that: each builder process drains ONE lane
 * (env `BUILDER_LANE`), and the enqueue side routes a service to the lane of
 * its assigned build server (`server.build_lane`: see
 * packages/api/src/lib/build-target.ts). Installs that never assign a build
 * server resolve everything to "default" and behave exactly as before.
 *
 * Queue naming is deliberately asymmetric: the default lane keeps the
 * pre-lane queue name `deploy.triggered` VERBATIM, so jobs enqueued before
 * this feature existed still drain after an upgrade: zero migration. Named
 * lanes get `deploy.triggered.<lane>`.
 *
 * Lane discovery: enqueue-side registration into a tiny Redis set
 * (`otterdeploy:deploy:lanes`, lane names only, never expired) lets readers
 * that must see EVERY lane (in-flight watchdog, reconcile, activity, cancel)
 * enumerate them without a static registry. The set only ever grows, which is
 * fine: a stale lane costs one empty-queue read.
 */

import { deployTriggeredJob } from "./jobs/deploy";

/** The shared lane every install starts on. Its queue name is the bare job
 *  name, unchanged from before lanes existed. */
export const DEFAULT_DEPLOY_LANE = "default";

const LANES_SET_KEY = "otterdeploy:deploy:lanes";

// Mirrors the BUILDER_LANE env validation (packages/env/src/server.ts) and
// keeps lane-derived queue names Redis/BullMQ-safe.
const LANE_NAME_RE = /^[a-z0-9-]{1,63}$/;

export function isDeployLaneName(value: string): boolean {
  return LANE_NAME_RE.test(value);
}

/**
 * The BullMQ queue a lane's jobs live on. The default lane maps to the bare
 * `deploy.triggered` (backward compatible: see module comment); any other
 * lane suffixes its name. Note the QUEUE name diverges from the JOB name for
 * non-default lanes: jobs on every lane still carry the job name
 * `deploy.triggered`, and handlers never care which queue delivered them.
 */
export function deployQueueName(lane: string): string {
  if (!isDeployLaneName(lane)) {
    throw new Error(
      `invalid deploy lane ${JSON.stringify(lane)}: must match ${LANE_NAME_RE.source}`,
    );
  }
  return lane === DEFAULT_DEPLOY_LANE
    ? deployTriggeredJob.name
    : `${deployTriggeredJob.name}.${lane}`;
}

// ─── Lane registry (Redis set) ───────────────────────────────────────────
//
// Raw Bun Redis client rather than BullMQ: the set is not a queue, and the
// same lazy-import idiom as reconcile.ts keeps `@otterdeploy/env` (which
// validates at load) out of this module's static import graph, so unit tests
// can import the pure helpers above without any env.

interface LanesRedis {
  send(command: string, args: string[]): Promise<unknown>;
}

let clientPromise: Promise<LanesRedis> | null = null;

async function lanesRedis(): Promise<LanesRedis> {
  if (!clientPromise) {
    clientPromise = (async () => {
      const { RedisClient } = await import("bun");
      const { env } = await import("@otterdeploy/env/server");
      return new RedisClient(env.REDIS_URL);
    })();
  }
  try {
    return await clientPromise;
  } catch (err) {
    // A rejected promise must not poison every later call: drop the cache so
    // the next caller retries (e.g. Redis came up after boot).
    clientPromise = null;
    throw err;
  }
}

/**
 * Record that a lane exists, so queue readers can enumerate it later. The
 * default lane is implicit (listDeployLanes always includes it), so only
 * named lanes touch Redis: the single-lane install pays nothing here.
 * Callers on the enqueue path let a failure propagate: if this SADD fails,
 * the queue.add right after it would have failed on the same Redis anyway.
 */
export async function registerDeployLane(lane: string): Promise<void> {
  // Validate before writing: an invalid name must never enter the set.
  deployQueueName(lane);
  if (lane === DEFAULT_DEPLOY_LANE) return;
  const client = await lanesRedis();
  await client.send("SADD", [LANES_SET_KEY, lane]);
}

/**
 * Every known lane, default first, named lanes sorted for stable output.
 *
 * Fails OPEN to `["default"]`: readers use this to fan out over queues, and
 * when Redis is unreachable the follow-up queue reads fail loudly on their
 * own: degrading discovery to the always-existing default lane never hides
 * an error, it only avoids a second failure mode. Entries that don't parse
 * as lane names are dropped rather than turned into malformed queue names.
 */
export async function listDeployLanes(): Promise<string[]> {
  let raw: unknown;
  try {
    const client = await lanesRedis();
    raw = await client.send("SMEMBERS", [LANES_SET_KEY]);
  } catch {
    return [DEFAULT_DEPLOY_LANE];
  }
  const named = (Array.isArray(raw) ? raw : [])
    .filter(
      (entry): entry is string =>
        typeof entry === "string" && entry !== DEFAULT_DEPLOY_LANE && isDeployLaneName(entry),
    )
    .sort();
  return [DEFAULT_DEPLOY_LANE, ...named];
}

/**
 * Is anything actually draining this lane right now?
 *
 * A build routed to a lane with no builder doesn't fail — it sits in Redis
 * forever while the deployment shows `pending` with no logs, which is the
 * least debuggable state the product has. BullMQ tracks connected workers per
 * queue (each registers a client with the queue's name), so this is a direct
 * question rather than a heuristic.
 *
 * Fails OPEN (returns true) when the check itself can't run: an unreachable
 * Redis will surface on the `queue.add` immediately afterwards with a better
 * message, and a monitoring blip must never block a deploy that would have
 * worked.
 */
export async function laneHasConsumer(lane: string): Promise<boolean> {
  try {
    const { getDeployQueue } = await import("./queues");
    const workers = await getDeployQueue(lane).getWorkers();
    return workers.length > 0;
  } catch {
    return true;
  }
}
