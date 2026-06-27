import type { ConnectionOptions } from "bullmq";

import { env } from "@otterdeploy/env/server";

/**
 * BullMQ connection options derived from REDIS_URL. BullMQ instantiates its
 * own ioredis client per Queue/Worker — we only hand it the connection
 * details, so we never import ioredis directly.
 *
 * `maxRetriesPerRequest: null` is required by BullMQ so blocking pops
 * (BRPOPLPUSH etc.) don't get retried and tear down the connection.
 */
let _connection: ConnectionOptions | null = null;

export function getConnection(): ConnectionOptions {
  if (_connection) return _connection;

  const url = new URL(env.REDIS_URL);
  const port = url.port ? Number(url.port) : 6379;
  const db = url.pathname.length > 1 ? Number(url.pathname.slice(1)) : 0;

  _connection = {
    host: url.hostname,
    port,
    username: url.username || undefined,
    password: url.password || undefined,
    db: Number.isFinite(db) ? db : 0,
    maxRetriesPerRequest: null,
  };
  return _connection;
}
