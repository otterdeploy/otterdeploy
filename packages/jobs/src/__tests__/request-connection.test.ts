/**
 * Request-path queues fail fast; worker connections stay blocking-safe.
 * These pin the options that produce that, since a regression here (say,
 * spreading the worker options back in) silently restores the hang.
 */
import { describe, expect, test } from "bun:test";

// oxlint-disable-next-line node/no-process-env -- test env setup boundary: connection.ts validates the environment at import.
process.env.REDIS_URL ??= "redis://:secret@redis.internal:6380/2";
// oxlint-disable-next-line node/no-process-env -- test env setup boundary (see above).
process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test";
// oxlint-disable-next-line node/no-process-env -- test env setup boundary (see above).
process.env.BETTER_AUTH_URL ??= "http://localhost:3000";
// oxlint-disable-next-line node/no-process-env -- test env setup boundary (see above).
process.env.BETTER_AUTH_SECRET ??= "test-secret-test-secret-test-secret-0123456789";
// oxlint-disable-next-line node/no-process-env -- test env setup boundary (see above).
process.env.CORS_ORIGIN ??= "http://localhost:3000";

const { getConnection, getRequestConnection } = await import("../connection");
const { QUEUE_COMMAND_TIMEOUT_MS } = await import("../timeouts");

describe("queue connection options", () => {
  test("request-path queues fail fast instead of buffering", () => {
    expect(getRequestConnection()).toMatchObject({
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      commandTimeout: QUEUE_COMMAND_TIMEOUT_MS,
    });
  });

  test("worker connections keep maxRetriesPerRequest: null, as BullMQ requires", () => {
    expect(getConnection()).toMatchObject({ maxRetriesPerRequest: null });
    expect(getConnection()).not.toHaveProperty("enableOfflineQueue");
  });

  test("both target the same Redis", () => {
    const pick = (o: object) => ({
      host: Reflect.get(o, "host"),
      port: Reflect.get(o, "port"),
      db: Reflect.get(o, "db"),
    });
    expect(pick(getRequestConnection())).toEqual(pick(getConnection()));
  });
});
