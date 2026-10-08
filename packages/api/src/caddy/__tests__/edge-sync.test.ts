/**
 * The reload queue route writers hand Caddy reloads to instead of
 * awaiting them. One reload at a time; a request that arrives mid-reload gets
 * exactly one follow-up (shared with every other such request), because the
 * running reload may have read the routes before that request's write.
 */
import { describe, expect, it } from "vite-plus/test";

import type { ReconcileResult } from "../reconciler";

import { edgeVerdict } from "../edge-state";
import { createEdgeSync } from "../edge-sync";

const OK: ReconcileResult = { applied: [], skipped: [], revision: "r" };

/** A reconcile each call of which waits until the test finishes it. */
function heldReconciles() {
  const pending: Array<(result: ReconcileResult) => void> = [];
  let calls = 0;
  return {
    reconcile: () =>
      new Promise<ReconcileResult>((resolve) => {
        calls += 1;
        pending.push(resolve);
      }),
    calls: () => calls,
    finishNext(result: ReconcileResult = OK) {
      const next = pending.shift();
      if (!next) throw new Error("no reconcile is running");
      next(result);
    },
  };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("createEdgeSync", () => {
  it("runs a request at once when nothing is in flight", async () => {
    const held = heldReconciles();
    const sync = createEdgeSync({ reconcile: held.reconcile });
    const outcome = sync.request();
    await tick();
    expect(held.calls()).toBe(1);
    held.finishNext();
    expect((await outcome).isOk()).toBe(true);
  });

  it("folds every request made mid-reload into one follow-up", async () => {
    const held = heldReconciles();
    const sync = createEdgeSync({ reconcile: held.reconcile });
    const first = sync.request();
    await tick();
    const second = sync.request();
    const third = sync.request();
    expect(second).toBe(third);
    // The follow-up waits for the running reload: never two loads at once.
    await tick();
    expect(held.calls()).toBe(1);

    held.finishNext();
    await first;
    await tick();
    expect(held.calls()).toBe(2);
    held.finishNext({ ...OK, revision: "follow-up" });
    const followUp = await second;
    expect(followUp.isOk() && followUp.value.revision).toBe("follow-up");
    await sync.idle();
    expect(held.calls()).toBe(2);
  });

  it("a request made while the follow-up runs gets a reload of its own", async () => {
    const held = heldReconciles();
    const sync = createEdgeSync({ reconcile: held.reconcile });
    void sync.request();
    await tick();
    const followUp = sync.request();
    held.finishNext();
    await tick();
    // The follow-up is running now, so it may already have read the routes.
    const late = sync.request();
    expect(late).not.toBe(followUp);
    held.finishNext();
    await followUp;
    await tick();
    expect(held.calls()).toBe(3);
    held.finishNext();
    await late;
  });

  it("never rejects, so a fire-and-forget caller cannot crash the process", async () => {
    const sync = createEdgeSync({
      reconcile: async () => {
        throw new Error("admin socket vanished");
      },
    });
    const outcome = await sync.request();
    expect(outcome.isErr() && outcome.error.message).toBe("admin socket vanished");
    // And the queue is free again afterwards.
    await sync.idle();
  });
});

describe("edgeVerdict", () => {
  it("a load Caddy refused fails every route it carried", () => {
    expect(edgeVerdict("prj_a", { ...OK, loadError: "boom" })).toEqual({
      state: "failed",
      error: "boom",
    });
  });

  it("a skipped project fails only its own routes", () => {
    const skipped = { ...OK, skipped: [{ projectId: "prj_a", error: "bad directive" }] };
    expect(edgeVerdict("prj_a", skipped)).toEqual({ state: "failed", error: "bad directive" });
    expect(edgeVerdict("prj_b", skipped)).toEqual({
      state: "synced",
    });
  });
});
