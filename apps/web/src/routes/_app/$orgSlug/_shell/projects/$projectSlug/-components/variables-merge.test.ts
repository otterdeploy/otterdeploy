/**
 * "Reload to merge" in the project bulk .env editor. The save was
 * refused because another tab changed the environment's variables; the
 * operator's text is re-based on the current set without losing either side.
 */
import { describe, expect, it } from "vite-plus/test";

import { mergeEnvText } from "./variables-merge";

describe("mergeEnvText", () => {
  const base = "SHARED=1\nOLD=x";
  // Tab A saved: added FROM_TAB_A, changed SHARED.
  const theirs = [
    { key: "FROM_TAB_A", value: "a" },
    { key: "OLD", value: "x" },
    { key: "SHARED", value: "2" },
  ];

  it("keeps the other tab's added variable and this editor's added variable", () => {
    expect(mergeEnvText(base, "SHARED=1\nOLD=x\nFROM_TAB_B=b", theirs)).toBe(
      "SHARED=2\nOLD=x\nFROM_TAB_B=b\nFROM_TAB_A=a",
    );
  });

  it("keeps this editor's delete and the other tab's edit", () => {
    expect(mergeEnvText(base, "SHARED=1", theirs)).toBe("SHARED=2\nFROM_TAB_A=a");
  });

  it("when both changed one key, this editor's value wins (it is visible before saving)", () => {
    expect(mergeEnvText(base, "SHARED=mine\nOLD=x", theirs)).toBe(
      "SHARED=mine\nOLD=x\nFROM_TAB_A=a",
    );
  });

  it("a key the other tab deleted and this editor left alone stays deleted", () => {
    expect(mergeEnvText(base, base, [{ key: "SHARED", value: "1" }])).toBe("SHARED=1");
  });
});
