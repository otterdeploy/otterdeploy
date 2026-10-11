/**
 * Two tabs on one resource's variables. Tab B's save names the
 * version of the set it loaded; when tab A saved in between, the server
 * refuses it (CONFLICT) and the editor offers "Reload to merge". These pin the
 * two pieces of client bookkeeping where a mistake silently loses a variable:
 * the version a draft names, and the re-base of the draft onto the current set.
 */

import { envSetVersion } from "@otterdeploy/shared/env-version";
import { describe, expect, it } from "vite-plus/test";

import type { DraftRow } from "../use-editor-state";

import { rebaseRows, serverSnapshotVersion, versionAfterSave } from "../use-editor-state";

function row(key: string, value: string, patch: Partial<DraftRow> = {}): DraftRow {
  return {
    id: `id-${key}`,
    key,
    value,
    isSecret: false,
    sealed: false,
    baseline: { key, value, isSecret: false },
    deleted: false,
    ...patch,
  };
}

const visible = (rows: DraftRow[]) =>
  rows.filter((r) => !r.deleted).map((r) => ({ key: r.key, value: r.value }));

describe("the version a Variables draft names", () => {
  it("is the server's version of the same set (the server compares the two)", () => {
    // Server side: envSetVersion over the rows as `list` returns them, sealed
    // value masked to "".
    const server = envSetVersion([
      { key: "A", value: "1", isSecret: false, sealed: false },
      { key: "S", value: "", isSecret: true, sealed: true },
    ]);
    expect(serverSnapshotVersion({ A: "1", S: "" }, ["S"], ["S"])).toBe(server);
  });

  it("changes when another tab adds a variable, so a stale save is detectable", () => {
    expect(serverSnapshotVersion({ A: "1" }, [])).not.toBe(
      serverSnapshotVersion({ A: "1", FROM_TAB_A: "a" }, []),
    );
  });

  it("after a save is the version of what was sent, sealed rows kept as they are", () => {
    const rows = [
      row("A", "1"),
      row("S", "", {
        sealed: true,
        isSecret: true,
        baseline: { key: "S", value: "", isSecret: true },
      }),
    ];
    const after = versionAfterSave(
      rows,
      [
        { key: "A", value: "2" },
        { key: "S", value: "" },
      ],
      ["S"],
    );
    expect(after).toBe(serverSnapshotVersion({ A: "2", S: "" }, ["S"], ["S"]));
  });
});

describe("rebaseRows: Reload to merge", () => {
  // Both tabs loaded {SHARED=1, OLD=x}. Tab A then saved FROM_TAB_A=a and
  // changed SHARED to 2. Tab B's draft: added FROM_TAB_B, deleted OLD.
  const fresh = [row("FROM_TAB_A", "a"), row("OLD", "x"), row("SHARED", "2")];

  it("keeps the other tab's variables and every edit in this draft", () => {
    const draft = [
      row("SHARED", "1"),
      row("OLD", "x", { deleted: true }),
      row("FROM_TAB_B", "b", { baseline: null }),
    ];
    const merged = rebaseRows(draft, fresh);
    expect(visible(merged)).toEqual([
      { key: "FROM_TAB_A", value: "a" },
      { key: "SHARED", value: "2" },
      { key: "FROM_TAB_B", value: "b" },
    ]);
    // OLD is still a pending delete against the current set.
    expect(merged.find((r) => r.key === "OLD")?.deleted).toBe(true);
  });

  it("an edited row becomes an edit of the server's current row (pending again)", () => {
    const draft = [
      row("SHARED", "mine", { baseline: { key: "SHARED", value: "1", isSecret: false } }),
    ];
    const merged = rebaseRows(draft, fresh);
    const shared = merged.find((r) => r.key === "SHARED");
    expect(shared?.value).toBe("mine");
    expect(shared?.baseline).toEqual({ key: "SHARED", value: "2", isSecret: false });
  });

  it("an edit of a variable the other tab deleted comes back as an added row", () => {
    const draft = [
      row("GONE", "mine", { baseline: { key: "GONE", value: "old", isSecret: false } }),
    ];
    const merged = rebaseRows(draft, fresh);
    expect(merged.find((r) => r.key === "GONE")).toMatchObject({ value: "mine", baseline: null });
  });

  it("a row both tabs added with the same key is one row, carrying this draft's value", () => {
    const draft = [row("FROM_TAB_A", "b", { baseline: null })];
    const merged = rebaseRows(draft, fresh);
    expect(merged.filter((r) => r.key === "FROM_TAB_A")).toHaveLength(1);
    expect(merged.find((r) => r.key === "FROM_TAB_A")?.value).toBe("b");
  });
});
