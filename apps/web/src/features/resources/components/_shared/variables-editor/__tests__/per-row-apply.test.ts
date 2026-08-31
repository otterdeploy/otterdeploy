/**
 * Applying ONE variable must not ship the rest of the draft.
 *
 * `bulkSet` replaces the whole bag, so a single-row apply has to send every
 * other row at its SAVED value and only the target row's edit. Getting this
 * wrong is silent and destructive: it would persist every pending change under
 * the guise of "apply this one", or drop rows nobody touched.
 */

import { describe, expect, it } from "vite-plus/test";

import type { DraftRow } from "../use-editor-state";

import { payloadForRowFrom } from "../use-editor-state";

/** A saved row, optionally edited in the current draft. */
function saved(key: string, value: string, patch: Partial<DraftRow> = {}): DraftRow {
  return {
    id: key.toLowerCase(),
    key,
    value,
    isSecret: false,
    baseline: { key, value, isSecret: false },
    deleted: false,
    ...patch,
  };
}

/** A row added in this draft: no baseline yet. */
function added(key: string, value: string): DraftRow {
  return { id: key.toLowerCase(), key, value, isSecret: false, baseline: null, deleted: false };
}

const keysOf = (rows: DraftRow[], id: string) => payloadForRowFrom(rows, id).env.map((e) => e.key);

describe("payloadForRowFrom", () => {
  it("sends the target's edit and every other row at its saved value", () => {
    const rows = [
      saved("ALPHA", "1", { value: "alpha-edited" }),
      saved("BETA", "2", { value: "beta-edited" }),
      saved("GAMMA", "3", {
        isSecret: true,
        baseline: { key: "GAMMA", value: "3", isSecret: true },
      }),
    ];
    const payload = payloadForRowFrom(rows, "alpha");
    expect(payload.env).toEqual([
      { key: "ALPHA", value: "alpha-edited" },
      { key: "BETA", value: "2" },
      { key: "GAMMA", value: "3" },
    ]);
    expect(payload.secretKeys).toEqual(["GAMMA"]);
  });

  it("omits a row added in this draft that is not the target", () => {
    const rows = [saved("ALPHA", "1", { value: "edited" }), added("NEW_ONE", "x")];
    expect(keysOf(rows, "alpha")).toEqual(["ALPHA"]);
  });

  it("includes a row added in this draft when it IS the target", () => {
    const rows = [saved("ALPHA", "1"), added("NEW_ONE", "x")];
    expect(payloadForRowFrom(rows, "new_one").env).toContainEqual({ key: "NEW_ONE", value: "x" });
  });

  it("drops the target when the target is the row being deleted", () => {
    const rows = [saved("ALPHA", "1"), saved("BETA", "2", { deleted: true })];
    expect(keysOf(rows, "beta")).toEqual(["ALPHA"]);
  });

  it("keeps a tombstoned row that is NOT the target: its delete is still pending", () => {
    const rows = [saved("ALPHA", "1", { value: "edited" }), saved("BETA", "2", { deleted: true })];
    expect(keysOf(rows, "alpha")).toContain("BETA");
  });

  it("carries a rename under the new name, for the target only", () => {
    const rows = [saved("ALPHA", "1", { key: "RENAMED" }), saved("BETA", "2")];
    expect(keysOf(rows, "alpha")).toEqual(["RENAMED", "BETA"]);
  });

  it("skips blank keys rather than sending an empty name", () => {
    const rows = [saved("ALPHA", "1"), added("", "orphan")];
    expect(keysOf(rows, "alpha")).toEqual(["ALPHA"]);
  });

  it("reports the target's own secret flag, not its saved one", () => {
    const rows = [saved("TOKEN", "t", { isSecret: true })];
    expect(payloadForRowFrom(rows, "token").secretKeys).toEqual(["TOKEN"]);
  });
});
