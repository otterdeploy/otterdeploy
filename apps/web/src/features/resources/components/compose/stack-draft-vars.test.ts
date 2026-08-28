import { describe, expect, test } from "vite-plus/test";

import { buildRows } from "./stack-draft-vars";

/**
 * The draft variables editor is the answer to a stack that deployed with its
 * domain unset because the only tab that could have set it was disabled for
 * being a draft. These pin the two rules that make it safe to save.
 */
describe("buildRows", () => {
  test("lists every ref the compose file declares, in file order", () => {
    const rows = buildRows(
      [
        { name: "AUTHENTIK_URL", default: null },
        { name: "PG_PASS", default: null },
      ],
      {},
    );
    expect(rows.map((r) => r.name)).toEqual(["AUTHENTIK_URL", "PG_PASS"]);
    expect(rows.every((r) => r.value === "")).toBe(true);
  });

  test("seeds each ref from the staged value", () => {
    const rows = buildRows([{ name: "AUTHENTIK_URL", default: null }], {
      AUTHENTIK_URL: "https://auth.example.com",
    });
    expect(rows[0]?.value).toBe("https://auth.example.com");
  });

  test("carries the file's own fallback so it can be shown as a placeholder", () => {
    const rows = buildRows([{ name: "PORT", default: "9000" }], {});
    expect(rows[0]?.fallback).toBe("9000");
  });

  // Saving rebuilds env from the rows, so a staged value the file no longer
  // references has to survive as a row. Dropping it here would delete it on
  // the next save, silently, for anyone who edited the compose first.
  test("keeps a staged value the compose file no longer references", () => {
    const rows = buildRows([{ name: "KEPT", default: null }], {
      KEPT: "a",
      ORPHAN: "b",
    });
    expect(rows.map((r) => r.name)).toEqual(["KEPT", "ORPHAN"]);
    expect(rows.find((r) => r.name === "ORPHAN")?.value).toBe("b");
  });
});
