/**
 * Unit tests for the in-app inbox fan-out gate + row mapping. Pure functions
 * only — the db module is mocked out so `bun test` runs without Postgres
 * (same pattern as reconcile.test.ts: dynamic import after mock.module so
 * @otterdeploy/db and its env validation never load).
 */
import { beforeAll, describe, expect, mock, test } from "bun:test";

let shouldFanOutInApp: typeof import("../jobs/notification-inbox").shouldFanOutInApp;
let inboxRowsFor: typeof import("../jobs/notification-inbox").inboxRowsFor;

beforeAll(async () => {
  mock.module("@otterdeploy/db", () => ({ db: {} }));
  mock.module("@otterdeploy/db/schema", () => ({ member: {}, notification: {} }));
  ({ shouldFanOutInApp, inboxRowsFor } = await import("../jobs/notification-inbox"));
});

describe("shouldFanOutInApp", () => {
  test("fans out for a real event the org subscribed a channel to", () => {
    expect(
      shouldFanOutInApp({
        eventId: "deploy.failed",
        testChannelId: undefined,
        subscribedChannelCount: 2,
      }),
    ).toBe(true);
  });

  test("never fans out test-mode deliveries or test.ping", () => {
    expect(
      shouldFanOutInApp({
        eventId: "deploy.failed",
        testChannelId: "notifchan_x",
        subscribedChannelCount: 2,
      }),
    ).toBe(false);
    expect(
      shouldFanOutInApp({
        eventId: "test.ping",
        testChannelId: undefined,
        subscribedChannelCount: 2,
      }),
    ).toBe(false);
  });

  test("skips events no channel is subscribed to (the matrix is the gate)", () => {
    expect(
      shouldFanOutInApp({
        eventId: "backup.failed",
        testChannelId: undefined,
        subscribedChannelCount: 0,
      }),
    ).toBe(false);
  });
});

describe("inboxRowsFor", () => {
  const event = {
    organizationId: "org_1",
    eventId: "backup.failed",
    title: "Backup failed",
    message: "db-main (acme): dump exited 1",
    data: { backupId: "backup_1" },
  };

  test("writes one in-app row per member, tagged with the occurrence key", () => {
    const rows = inboxRowsFor(event, ["user_a", "user_b"], "job:42");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      userId: "user_a",
      organizationId: "org_1",
      channel: "in-app",
      title: "Backup failed",
      message: "db-main (acme): dump exited 1",
      data: { backupId: "backup_1", eventId: "backup.failed", occurrence: "job:42" },
    });
    expect(rows[1]?.userId).toBe("user_b");
  });

  test("event data can never clobber the eventId/occurrence tags", () => {
    const rows = inboxRowsFor(
      { ...event, data: { occurrence: "spoof", eventId: "spoof" } },
      ["user_a"],
      "job:7",
    );
    expect(rows[0]?.data).toEqual({ eventId: "backup.failed", occurrence: "job:7" });
  });

  test("no members → no rows", () => {
    expect(inboxRowsFor(event, [], "job:9")).toEqual([]);
  });
});
