/**
 * The multi-lane in-flight union: pure, against fake queues. The property
 * under test is the watchdog discriminator: ownership and activity must be
 * the UNION over every lane, so a build active on one lane keeps a deploy
 * queued on another lane from being declared abandoned.
 */
import { describe, expect, test } from "bun:test";

import type { InFlightQueueLike } from "../in-flight-core";

import { collectInFlightDeploys } from "../in-flight-core";

function fakeQueue(input: { owned: string[][]; active: number }): InFlightQueueLike {
  return {
    getJobs: async () => input.owned.map((deploymentIds) => ({ data: { deploymentIds } })),
    getJobCounts: async () => ({ active: input.active }),
  };
}

describe("collectInFlightDeploys", () => {
  test("no queues → empty and inactive", async () => {
    expect(await collectInFlightDeploys([])).toEqual({ ownedIds: new Set(), anyActive: false });
  });

  test("unions ownedIds across lanes", async () => {
    const result = await collectInFlightDeploys([
      fakeQueue({ owned: [["d1", "d2"]], active: 0 }),
      fakeQueue({ owned: [["d2"], ["d3"]], active: 0 }),
    ]);
    expect(result.ownedIds).toEqual(new Set(["d1", "d2", "d3"]));
    expect(result.anyActive).toBe(false);
  });

  test("one active lane makes anyActive true even when the others idle", async () => {
    const result = await collectInFlightDeploys([
      fakeQueue({ owned: [], active: 0 }),
      fakeQueue({ owned: [["d9"]], active: 1 }),
    ]);
    expect(result.anyActive).toBe(true);
    expect(result.ownedIds).toEqual(new Set(["d9"]));
  });

  test("malformed job payloads are skipped, not fatal", async () => {
    const weird: InFlightQueueLike = {
      getJobs: async () => [
        undefined,
        {},
        { data: {} },
        { data: { deploymentIds: "not-an-array" } },
        { data: { deploymentIds: [42, "ok"] } },
      ],
      getJobCounts: async () => ({}),
    };
    const result = await collectInFlightDeploys([weird]);
    expect(result.ownedIds).toEqual(new Set(["ok"]));
    expect(result.anyActive).toBe(false);
  });
});
