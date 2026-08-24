import { Queue } from "bullmq";

import { getConnection } from "./connection";
import { DEFAULT_DEPLOY_LANE, deployQueueName, listDeployLanes } from "./lanes";
import { jobs } from "./registry";

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

/** Close every cached queue. Call on shutdown. */
export async function closeQueues(): Promise<void> {
  await Promise.all(Array.from(queueCache.values()).map((q) => q.close()));
  queueCache.clear();
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
