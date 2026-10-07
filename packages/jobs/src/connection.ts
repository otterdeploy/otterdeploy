import type { ConnectionOptions } from "bullmq";

import { env } from "@otterdeploy/env/server";

import { QUEUE_COMMAND_TIMEOUT_MS } from "./timeouts";

/**
 * BullMQ connection options derived from REDIS_URL. BullMQ instantiates its
 * own ioredis client per Queue/Worker, we only hand it the connection
 * details, so we never import ioredis directly.
 *
 * `maxRetriesPerRequest: null` is required by BullMQ so blocking pops
 * (BRPOPLPUSH etc.) don't get retried and tear down the connection.
 */
let _connection: ConnectionOptions | null = null;

/** Host, port, credentials and db index from REDIS_URL. */
function redisEndpoint() {
  const url = new URL(env.REDIS_URL);
  const port = url.port ? Number(url.port) : 6379;
  const db = url.pathname.length > 1 ? Number(url.pathname.slice(1)) : 0;
  return {
    host: url.hostname,
    port,
    username: url.username || undefined,
    password: url.password || undefined,
    db: Number.isFinite(db) ? db : 0,
  };
}

export function getConnection(): ConnectionOptions {
  _connection ??= { ...redisEndpoint(), maxRetriesPerRequest: null };
  return _connection;
}

let _requestConnection: ConnectionOptions | null = null;

/**
 * Connection options for request-path queues: the same Redis, but failing
 * fast instead of buffering. `enableOfflineQueue: false` rejects a command
 * issued while disconnected (rather than parking it, which would also enqueue
 * a job the caller was told failed once Redis returns); `maxRetriesPerRequest:
 * 1` bounds a command caught by a disconnect. Never use these for a Worker or
 * QueueEvents: blocking commands need `maxRetriesPerRequest: null`.
 */
export function getRequestConnection(): ConnectionOptions {
  _requestConnection ??= {
    ...redisEndpoint(),
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    commandTimeout: QUEUE_COMMAND_TIMEOUT_MS,
  };
  return _requestConnection;
}
