import { withTimeout } from "@otterdeploy/shared/promise";
import { Result, TaggedError } from "better-result";
import { Queue } from "bullmq";

import { getConnection, getRequestConnection } from "./connection";
import { DEFAULT_DEPLOY_LANE, deployQueueName, listDeployLanes } from "./lanes";
import { jobs } from "./registry";
import { QUEUE_READY_TIMEOUT_MS } from "./timeouts";

/**
 * One BullMQ Queue per job definition. Keyed by `JobDef.name`.
 * Queues share the connection options (BullMQ instantiates its own ioredis
 * client per queue under the hood).
 */
const queueCache = new Map<string, Queue>();

export function getQueue(name: string): Queue {
  const existing = queueCache.get(name);
  if (existing) return existing;
  const queue = new Queue(name, { connection: getConnection() });
  queueCache.set(name, queue);
  return queue;
}

/** Eagerly build a Queue for every job. Useful for the dashboard. */
export function getAllQueues(): Queue[] {
  return jobs.map((job) => getQueue(job.name));
}

/** The deploy queue for one lane. The default lane is the plain
 *  `deploy.triggered` queue: same object the registry-derived paths use. */
export function getDeployQueue(lane: string = DEFAULT_DEPLOY_LANE): Queue {
  return getQueue(deployQueueName(lane));
}

/**
 * Every deploy lane queue currently known: the default lane first, then any
 * named lanes discovered via the Redis lane set. Readers that must not miss a
 * build (in-flight watchdog, reconcile, activity, cancel) fan out over this
 * instead of reading the single global queue.
 */
export async function allDeployQueues(): Promise<Queue[]> {
  const lanes = await listDeployLanes();
  return lanes.map((lane) => getDeployQueue(lane));
}

/**
 * A request-path queue could not be reached in time (Redis down, restarting,
 * or hung). Typed so an API handler can answer "the job queue is unavailable"
 * instead of waiting for its procedure deadline.
 */
export class JobQueueUnavailableError extends TaggedError("JobQueueUnavailableError")<{
  queue: string;
  message: string;
  cause: unknown;
}>() {
  constructor(args: { queue: string; cause: unknown }) {
    const detail = args.cause instanceof Error ? args.cause.message : String(args.cause);
    super({
      queue: args.queue,
      cause: args.cause,
      message: `job queue ${args.queue} is unavailable (is Redis reachable?): ${detail}`,
    });
  }
}

/** Request-path twins of the cached queues, on the fail-fast connection. */
const requestQueueCache = new Map<string, Queue>();

/** Request queues whose last ready wait timed out (Redis unreachable). */
const unreadyQueues = new Set<string>();

/**
 * The named queue for a REQUEST path, once its connection is ready. Fails with
 * JobQueueUnavailableError after QUEUE_READY_TIMEOUT_MS instead of waiting for
 * Redis indefinitely, and nothing is issued on a connection that never became
 * ready, so a timed-out enqueue can never land later as a ghost job.
 * Workers and background readers keep using getQueue.
 */
export async function resolveRequestQueue(
  name: string,
): Promise<Result<Queue, JobQueueUnavailableError>> {
  let queue = requestQueueCache.get(name);
  if (!queue) {
    queue = new Queue(name, { connection: getRequestConnection() });
    requestQueueCache.set(name, queue);
  }
  const ready = queue;
  // Once a queue's connection has failed to become ready, later callers do
  // not each wait the full budget again: one request path can fire several
  // enqueues (a deploy's started + failed notifications), and an outage
  // would otherwise cost every one of them QUEUE_READY_TIMEOUT_MS in turn.
  // A connection that has since become ready resolves at once either way.
  const budget = unreadyQueues.has(name) ? 0 : QUEUE_READY_TIMEOUT_MS;
  const waited = await Result.tryPromise({
    try: () => withTimeout(ready.waitUntilReady(), budget, `queue ${name} ready`),
    catch: (cause) => new JobQueueUnavailableError({ queue: name, cause }),
  });
  if (waited.isErr()) unreadyQueues.add(name);
  else unreadyQueues.delete(name);
  return waited.map(() => ready);
}

/** Run one request-path queue operation, every failure typed as unavailable. */
export async function runOnRequestQueue<T>(
  name: string,
  operation: (queue: Queue) => Promise<T>,
): Promise<T> {
  const ran = await (
    await resolveRequestQueue(name)
  ).andThenAsync((queue) =>
    Result.tryPromise({
      try: () => operation(queue),
      catch: (cause) => new JobQueueUnavailableError({ queue: name, cause }),
    }),
  );
  if (ran.isErr()) throw ran.error;
  return ran.value;
}

/** Close every cached queue. Call on shutdown. */
export async function closeQueues(): Promise<void> {
  const all = [...queueCache.values(), ...requestQueueCache.values()];
  await Promise.all(all.map((q) => q.close()));
  queueCache.clear();
  requestQueueCache.clear();
  unreadyQueues.clear();
}

/**
 * Is anything actually draining this lane right now?
 *
 * A build routed to a lane with no builder doesn't fail — it sits in Redis
 * forever while the deployment shows `pending` with no logs, which is the
 * least debuggable state the product has. BullMQ tracks connected workers per
 * queue, so this is a direct question rather than a heuristic.
 *
 * Lives here rather than in lanes.ts on purpose: lanes.ts owns lane NAMING and
 * is imported by this module, so reaching back for a Queue from there would
 * make lanes ⇄ queues a cycle (and drag three more job modules into it).
 *
 * Fails OPEN (returns true) when the check itself can't run: an unreachable
 * Redis will surface on the `queue.add` immediately afterwards with a better
 * message, and a monitoring blip must never block a deploy that would have
 * worked.
 */
export async function laneHasConsumer(lane: string): Promise<boolean> {
  try {
    const workers = await getDeployQueue(lane).getWorkers();
    return workers.length > 0;
  } catch {
    return true;
  }
}
