import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, test } from "vite-plus/test";

import { teardownBumpFragment } from "../preview-env";

/**
 * Regression guard for the preview-upsert timestamp bug: the on-conflict
 * `auto_teardown_at` bump is a raw `sql` fragment, so drizzle doesn't map the
 * value. It bit twice in prod — first a bare Date bound as `Date.toString()`
 * ("… (Coordinated Universal Time)", invalid timestamp syntax), then a bare ISO
 * string bound as `text` (column is timestamp → type mismatch). The fix binds
 * an ISO string cast to `timestamp`. Compile the fragment and assert both.
 */
describe("teardownBumpFragment", () => {
  const dialect = new PgDialect();
  const at = new Date("2026-07-11T22:43:55.887Z");
  const { sql, params } = dialect.sqlToQuery(teardownBumpFragment(at));

  test("casts the bound value to timestamp (not left as text)", () => {
    expect(sql).toContain("::timestamp");
  });

  test("binds the teardown instant as an ISO string, not Date.toString()", () => {
    expect(params).toContain("2026-07-11T22:43:55.887Z");
    // The `Date.toString()` locale format is exactly what broke prod.
    expect(sql).not.toMatch(/Coordinated Universal Time/);
    for (const p of params) {
      expect(String(p)).not.toMatch(/Coordinated Universal Time/);
    }
  });

  test("preserves a keep-alive pin (NULL stays NULL)", () => {
    expect(sql.toLowerCase()).toContain("is null then null");
  });
});
