/**
 * Request-path bounds for the job queue. Kept free of
 * `@otterdeploy/env` so modules that must not validate the environment at
 * import (lanes.ts) can use them too.
 */

/**
 * How long a REQUEST-path queue call (an enqueue from an API handler, a
 * dashboard's queue counts) waits for its Redis connection to be ready before
 * failing with JobQueueUnavailableError. The worker-shaped connection
 * (connection.ts getConnection) waits forever, which is right for a worker and
 * wrong for a request: with Redis down, every enqueue parked until the 120s
 * procedure deadline. A healthy local Redis is ready in
 * milliseconds (connect plus one INFO); 3s is two orders of magnitude of
 * headroom and still answers a waiting user promptly.
 */
export const QUEUE_READY_TIMEOUT_MS = 3_000;

/**
 * ioredis `commandTimeout` for request-path queue clients: a Redis that
 * accepts the connection but never answers (hung, or a dropped network)
 * fails the command instead of holding the request. Generous next to the
 * sub-millisecond commands a queue add or count issues.
 */
export const QUEUE_COMMAND_TIMEOUT_MS = 5_000;
