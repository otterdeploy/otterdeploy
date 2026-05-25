import { Queue } from "bullmq";

import { getConnection } from "./connection";
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

/** Close every cached queue. Call on shutdown. */
export async function closeQueues(): Promise<void> {
  await Promise.all(Array.from(queueCache.values()).map((q) => q.close()));
  queueCache.clear();
}
