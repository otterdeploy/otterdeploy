import type { CellValue } from "@otterdeploy/data-engine";

import { describe, expect, it } from "vite-plus/test";

import type { Draft, PrimaryKeys } from "./drafts";

import {
  draftFor,
  groupByRow,
  removeDraft,
  removeRowDrafts,
  rowKey,
  sameCell,
  toMutations,
  upsertDraft,
} from "./drafts";

const pk = (id: string): PrimaryKeys => ({ id: { k: "bigint", v: id } });
const text = (v: string): CellValue => ({ k: "text", v });

const draft = (id: string, column: string, value: CellValue, previous: CellValue): Draft => ({
  primaryKeys: pk(id),
  column,
  value,
  previous,
});

describe("row identity", () => {
  it("does not depend on key order", () => {
    const a: PrimaryKeys = { a: text("1"), b: text("2") };
    const b: PrimaryKeys = { b: text("2"), a: text("1") };
    expect(rowKey(a)).toBe(rowKey(b));
  });

  it("distinguishes a bigint from text holding the same digits", () => {
    // Two different rows in a table keyed by a text column vs an int8 one.
    // Comparing rendered values alone would merge them.
    expect(rowKey({ id: { k: "bigint", v: "8" } })).not.toBe(rowKey({ id: text("8") }));
  });

  it("distinguishes NULL from the empty string", () => {
    expect(rowKey({ id: null })).not.toBe(rowKey({ id: text("") }));
  });

  it("does not collide when column names and values contain separators", () => {
    expect(rowKey({ "a=b": text("c|d") })).not.toBe(rowKey({ a: text("b=c|d") }));
  });
});

describe("upsertDraft", () => {
  it("replaces rather than queues when the same cell is edited twice", () => {
    // The diff should show where the row is GOING, not the path it took.
    let drafts = upsertDraft([], draft("1", "status", text("paid"), text("pending")));
    drafts = upsertDraft(drafts, draft("1", "status", text("refunded"), text("paid")));
    expect(drafts).toHaveLength(1);
    expect(drafts[0]?.value).toEqual(text("refunded"));
    expect(drafts[0]?.previous).toEqual(text("pending"));
  });

  it("drops the draft when an edit returns the cell to its original value", () => {
    // Otherwise the bar would say "1 unsaved change" for a change that isn't one.
    let drafts = upsertDraft([], draft("1", "status", text("paid"), text("pending")));
    drafts = upsertDraft(drafts, draft("1", "status", text("pending"), text("paid")));
    expect(drafts).toEqual([]);
  });

  it("keeps edits to different cells of the same row separate", () => {
    let drafts = upsertDraft([], draft("1", "status", text("paid"), text("pending")));
    drafts = upsertDraft(drafts, draft("1", "note", text("x"), null));
    expect(drafts).toHaveLength(2);
  });

  it("treats setting a cell to NULL as a real change", () => {
    const drafts = upsertDraft([], draft("1", "note", null, text("something")));
    expect(drafts).toHaveLength(1);
    expect(drafts[0]?.value).toBeNull();
  });
});

describe("sameCell", () => {
  it("compares by value AND kind, not by rendered text", () => {
    expect(sameCell(text("8"), text("8"))).toBe(true);
    expect(sameCell({ k: "bigint", v: "8" }, text("8"))).toBe(false);
    expect(sameCell(null, null)).toBe(true);
    expect(sameCell(null, text(""))).toBe(false);
  });

  it("compares json structurally", () => {
    expect(sameCell({ k: "json", v: { a: 1 } }, { k: "json", v: { a: 1 } })).toBe(true);
    expect(sameCell({ k: "json", v: { a: 1, b: 2 } }, { k: "json", v: { b: 2, a: 1 } })).toBe(true);
    expect(sameCell({ k: "json", v: { a: 1 } }, { k: "json", v: { a: 2 } })).toBe(false);
  });
});

describe("removal", () => {
  const drafts = [
    draft("1", "status", text("paid"), text("pending")),
    draft("1", "note", text("x"), null),
    draft("2", "status", text("paid"), text("pending")),
  ];

  it("removes one cell", () => {
    const out = removeDraft(drafts, { primaryKeys: pk("1"), column: "note" });
    expect(out).toHaveLength(2);
    expect(draftFor(out, pk("1"), "note")).toBeUndefined();
    expect(draftFor(out, pk("1"), "status")).toBeDefined();
  });

  it("removes a whole row's edits", () => {
    const out = removeRowDrafts(drafts, pk("1"));
    expect(out).toHaveLength(1);
    expect(out[0]?.primaryKeys).toEqual(pk("2"));
  });
});

describe("toMutations", () => {
  const table = { schema: "public", name: "orders" };

  it("emits ONE update per row, not per cell", () => {
    // Four edited columns of one row must be one statement: fewer round trips,
    // and the only way a constraint spanning them can be satisfied.
    const drafts = [
      draft("1", "status", text("paid"), text("pending")),
      draft("1", "note", text("x"), null),
      draft("2", "status", text("paid"), text("pending")),
    ];
    const mutations = toMutations(drafts, table);
    expect(mutations).toHaveLength(2);
    expect(mutations[0]?.set).toHaveLength(2);
    expect(mutations[0]?.expected).toEqual([
      { column: "status", value: text("pending") },
      { column: "note", value: null },
    ]);
    expect(mutations[1]?.set).toHaveLength(1);
  });

  it("carries the full primary key as the predicate", () => {
    const composite: Draft = {
      primaryKeys: { a: text("1"), b: text("2") },
      column: "v",
      value: text("new"),
      previous: text("old"),
    };
    const [mutation] = toMutations([composite], table);
    expect(mutation?.pk).toHaveLength(2);
    expect(mutation?.op).toBe("update");
  });

  it("produces nothing for no drafts", () => {
    expect(toMutations([], table)).toEqual([]);
  });
});

describe("groupByRow", () => {
  it("keeps rows in the order their first edit was made", () => {
    const drafts = [
      draft("2", "status", text("a"), text("b")),
      draft("1", "status", text("a"), text("b")),
      draft("2", "note", text("a"), text("b")),
    ];
    expect(groupByRow(drafts).map((g) => g.primaryKeys)).toEqual([pk("2"), pk("1")]);
  });
});
