import { beforeEach, describe, expect, test, vi } from "vite-plus/test";

vi.mock("../blocklist-egress", () => ({
  blocklistEgressDenylist: vi.fn().mockResolvedValue({}),
}));
vi.mock("../../../security/public-fetch", () => ({
  fetchPublicText: vi.fn(),
}));
vi.mock("../cscli", () => ({
  cscliRun: vi.fn(),
}));
vi.mock("../queries", () => ({
  setBlocklistSyncResult: vi.fn(),
}));

import type { BlocklistRow } from "../queries";

import { fetchPublicText } from "../../../security/public-fetch";
import { cscliRun } from "../cscli";
import { setBlocklistSyncResult } from "../queries";
import { clearBlocklist, syncBlocklist } from "../sync";

const row = {
  id: "bl_test",
  name: "Test",
  url: "https://list.example/ips.txt",
  catalogSlug: null,
  enabled: true,
  durationHours: 24,
  intervalMinutes: 60,
  lastSyncedAt: null,
  lastStatus: "ok",
  lastError: null,
  lastCount: 1,
  activeScenario: "blocklist:bl_test:a",
  createdAt: new Date(0),
  updatedAt: new Date(0),
} as BlocklistRow;

describe("syncBlocklist blue/green replacement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("preserves the active generation when the download fails", async () => {
    vi.mocked(fetchPublicText).mockRejectedValue(new Error("unsafe redirect"));

    await expect(syncBlocklist(row)).resolves.toEqual({
      ok: false,
      count: 0,
      error: "unsafe redirect",
    });

    expect(cscliRun).not.toHaveBeenCalled();
    expect(setBlocklistSyncResult).toHaveBeenNthCalledWith(1, row.id, { status: "pending" });
    expect(setBlocklistSyncResult).toHaveBeenNthCalledWith(2, row.id, {
      status: "error",
      error: "unsafe redirect",
    });
  });

  test("does not clear the active generation when import fails", async () => {
    vi.mocked(cscliRun)
      .mockResolvedValueOnce("")
      .mockResolvedValueOnce("Import failed: invalid value");

    const result = await syncBlocklist(row, ["1.1.1.1"]);

    expect(result.ok).toBe(false);
    expect(cscliRun).toHaveBeenCalledTimes(2);
    expect(cscliRun).not.toHaveBeenCalledWith(
      expect.any(String),
      ["blocklist:bl_test:a"],
      expect.anything(),
    );
    expect(setBlocklistSyncResult).not.toHaveBeenCalledWith(
      row.id,
      expect.objectContaining({ status: "ok" }),
    );
  });

  test("stops before import when the inactive generation cannot be prepared", async () => {
    vi.mocked(cscliRun).mockResolvedValueOnce(null);

    const result = await syncBlocklist(row, ["1.1.1.1"]);

    expect(result.ok).toBe(false);
    expect(result.error).toContain("inactive");
    expect(cscliRun).toHaveBeenCalledOnce();
    expect(setBlocklistSyncResult).not.toHaveBeenCalledWith(
      row.id,
      expect.objectContaining({ status: "ok" }),
    );
  });

  test("persists the replacement before clearing the old generation", async () => {
    const order: string[] = [];
    vi.mocked(cscliRun).mockImplementation(async (_script, args, options) => {
      if (options?.input) {
        order.push("import");
        expect(args).toEqual(["blocklist:bl_test:b", "24h"]);
        expect(options.input).toBe("1.1.1.1\n2001:4860:4860::8888\n");
        return "Imported 2 decisions";
      }
      order.push(`clear:${args[0]}`);
      return "";
    });
    vi.mocked(setBlocklistSyncResult).mockImplementation(async (_id, result) => {
      if (result.status === "ok") order.push("persist");
    });

    await expect(syncBlocklist(row, ["1.1.1.1", "2001:4860:4860::8888"])).resolves.toEqual({
      ok: true,
      count: 2,
    });

    expect(order).toEqual([
      "clear:blocklist:bl_test:b",
      "import",
      "persist",
      "clear:blocklist:bl_test:a",
    ]);
    expect(setBlocklistSyncResult).toHaveBeenCalledWith(row.id, {
      status: "ok",
      count: 2,
      activeScenario: "blocklist:bl_test:b",
    });
  });

  test("clears the active generation last so a partial clear fails closed", async () => {
    vi.mocked(cscliRun).mockResolvedValue("");

    await expect(clearBlocklist(row)).resolves.toBe(true);

    expect(vi.mocked(cscliRun).mock.calls.map((call) => call[1][0])).toEqual([
      "blocklist:bl_test",
      "blocklist:bl_test:b",
      "blocklist:bl_test:a",
    ]);
  });
});
