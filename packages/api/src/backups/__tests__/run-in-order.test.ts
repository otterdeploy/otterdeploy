/**
 * One backup run to two destinations always failed one of them. The router
 * started every destination's executeBackup at once, and the engine's
 * per-source lock refused all but the first. The batch now runs in order:
 * the next destination starts only after the previous one settled.
 */
import { ID_PREFIX, createId } from "@otterdeploy/shared/id";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const calls: string[] = [];
const failOn = new Set<string>();

vi.mock("../engine", () => ({
  executeBackup: async (id: string) => {
    calls.push(`start ${id}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
    if (failOn.has(id)) throw new Error("context read failed");
    calls.push(`end ${id}`);
  },
}));

const failed: Array<{ id: string; message: string }> = [];
vi.mock("../db", () => ({
  markBackupFailed: async (id: string, message: string) => {
    failed.push({ id, message });
    return true;
  },
}));

const { executeBackupsInOrder } = await import("../run-in-order");

const ids = [createId(ID_PREFIX.backup), createId(ID_PREFIX.backup), createId(ID_PREFIX.backup)];
const [a, b, c] = ids.map(String);

beforeEach(() => {
  calls.length = 0;
  failed.length = 0;
  failOn.clear();
});

describe("executeBackupsInOrder", () => {
  it("starts each run only after the previous one settled", async () => {
    await executeBackupsInOrder(ids);
    expect(calls).toEqual([
      `start ${a}`,
      `end ${a}`,
      `start ${b}`,
      `end ${b}`,
      `start ${c}`,
      `end ${c}`,
    ]);
  });

  it("a run that throws is failed, and the rest still run", async () => {
    failOn.add(String(b));
    await executeBackupsInOrder(ids);
    expect(calls).toEqual([`start ${a}`, `end ${a}`, `start ${b}`, `start ${c}`, `end ${c}`]);
    expect(failed).toEqual([{ id: b, message: "backup did not start: context read failed" }]);
  });
});
