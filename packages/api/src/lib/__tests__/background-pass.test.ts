import { afterEach, describe, expect, it, vi } from "vite-plus/test";

const logged = vi.hoisted(() => {
  const errors: unknown[] = [];
  return { errors };
});
vi.mock("evlog", () => ({
  log: { error: (fields: unknown) => logged.errors.push(fields) },
}));

import { runBackgroundPass } from "../background-pass";

afterEach(() => {
  logged.errors.length = 0;
});

/** Let the pass and its outcome handler settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("runBackgroundPass", () => {
  it("a pass that rejects is logged under its task, not rethrown", async () => {
    runBackgroundPass("node-enrollment-reaper", async () => {
      throw new Error("Failed to connect");
    });
    await settle();
    expect(logged.errors).toEqual([
      {
        background: { task: "node-enrollment-reaper", status: "failed" },
        error: "Failed to connect",
      },
    ]);
  });

  it("a pass that throws before its first await is contained too", async () => {
    runBackgroundPass("backup-scheduler", () => {
      throw new Error("sync");
    });
    await settle();
    expect(logged.errors).toHaveLength(1);
  });

  it("a pass that succeeds logs nothing", async () => {
    let ran = false;
    runBackgroundPass("edge-watch", async () => {
      ran = true;
    });
    await settle();
    expect(ran).toBe(true);
    expect(logged.errors).toEqual([]);
  });
});
