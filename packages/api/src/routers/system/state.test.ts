import { describe, expect, it } from "vite-plus/test";

import * as state from "./state";

describe("update run state", () => {
  it("guards concurrency via isRunning across the lifecycle", () => {
    expect(state.isRunning()).toBe(false);
    state.begin("v1.0.0");
    expect(state.isRunning()).toBe(true);
    expect(state.snapshot().status).toBe("running");
    expect(state.snapshot().targetVersion).toBe("v1.0.0");
    state.finish(true);
    expect(state.isRunning()).toBe(false);
    expect(state.snapshot().status).toBe("succeeded");
  });

  it("records failure with an error message", () => {
    state.begin("v1.2.3");
    state.finish(false, "boom");
    const snap = state.snapshot();
    expect(snap.status).toBe("failed");
    expect(snap.error).toBe("boom");
  });

  it("streams begin → emit → finish events in order and terminates", async () => {
    state.begin("v2.0.0");

    const collected: string[] = [];
    const consume = (async () => {
      for await (const event of state.streamProgress(undefined)) {
        collected.push(event.message);
      }
    })();

    // Listener is registered synchronously by the first generator step, so
    // these emits are all observed by the live tail.
    state.emit("validate", "checking");
    state.emit("pull", "pulling", "info");
    state.finish(true);

    await consume;
    expect(collected).toEqual(["checking", "pulling"]);
  });

  it("cancel() forces a running run to failed and emits a final line", () => {
    state.begin("v4.0.0");
    const cancelled = state.cancel("reset by operator");
    expect(cancelled).toBe(true);
    const snap = state.snapshot();
    expect(snap.status).toBe("failed");
    expect(snap.error).toBe("reset by operator");
    expect(snap.logs.at(-1)?.message).toBe("reset by operator");
    expect(snap.logs.at(-1)?.level).toBe("error");
  });

  it("cancel() is a no-op when nothing is running", () => {
    state.finish(true); // ensure terminal/idle
    expect(state.cancel("nothing to do")).toBe(false);
  });

  it("ends the stream on handoff (server about to be replaced)", async () => {
    state.begin("v3.0.0");
    const consume = (async () => {
      const seen: string[] = [];
      for await (const event of state.streamProgress(undefined)) seen.push(event.message);
      return seen;
    })();
    state.emit("recreate", "launching helper");
    state.markHandoff();
    const seen = await consume;
    expect(seen).toEqual(["launching helper"]);
    expect(state.snapshot().handedOff).toBe(true);
  });
});
