import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, test } from "vite-plus/test";

import {
  applyFilters,
  comparison,
  escapeLike,
  eventWhere,
  screenCase,
  sessionWhere,
} from "../query/filters";

const dialect = new PgDialect();

function render(fragment: ReturnType<typeof sql> | undefined): { sql: string; params: unknown[] } {
  if (!fragment) throw new Error("expected a SQL fragment");
  return dialect.sqlToQuery(fragment);
}

describe("comparison", () => {
  test("is binds the value as a parameter", () => {
    const q = render(comparison(sql`x`, "is", "/pricing"));
    expect(q.sql).toBe("x = $1");
    expect(q.params).toEqual(["/pricing"]);
  });

  test("isNot uses IS DISTINCT FROM so null rows count as 'not X'", () => {
    const q = render(comparison(sql`x`, "isNot", "google.com"));
    expect(q.sql).toBe("x IS DISTINCT FROM $1");
  });

  test("(none) and Direct / none compile to null checks", () => {
    expect(render(comparison(sql`x`, "is", "(none)")).sql).toBe("x IS NULL");
    expect(render(comparison(sql`x`, "is", "Direct / none")).sql).toBe("x IS NULL");
    expect(render(comparison(sql`x`, "isNot", "(none)")).sql).toBe("x IS NOT NULL");
  });

  test("contains escapes LIKE wildcards in the bound parameter", () => {
    const q = render(comparison(sql`x`, "contains", "50%_off\\x"));
    expect(q.sql).toBe("x ILIKE $1");
    expect(q.params).toEqual(["%50\\%\\_off\\\\x%"]);
  });
});

describe("escapeLike", () => {
  test("escapes %, _ and backslash; leaves everything else alone", () => {
    expect(escapeLike("a%b_c\\d")).toBe("a\\%b\\_c\\\\d");
    expect(escapeLike("/plain/path")).toBe("/plain/path");
  });
});

describe("eventWhere / sessionWhere", () => {
  test("event dims compile against analytics_event columns", () => {
    const q = render(eventWhere([{ dim: "path", op: "is", value: "/docs" }]));
    expect(q.sql).toContain('"analytics_event"."path" = $1');
  });

  test("session dims compile against analytics_session columns", () => {
    const q = render(sessionWhere([{ dim: "entryPath", op: "is", value: "/" }]));
    expect(q.sql).toContain('"analytics_session"."entry_path" = $1');
  });

  test("dims the target does not carry are skipped by the direct builders", () => {
    expect(eventWhere([{ dim: "entryPath", op: "is", value: "/" }])).toBeUndefined();
    expect(sessionWhere([{ dim: "path", op: "is", value: "/" }])).toBeUndefined();
  });

  test("channel compiles to the generated CASE, values parameterized", () => {
    const q = render(eventWhere([{ dim: "channel", op: "is", value: "Paid Social" }]));
    expect(q.sql).toContain("CASE WHEN lower(");
    expect(q.sql).toContain("'Organic Search'");
    expect(q.sql).toContain("'Direct'");
    // The compared channel name is a parameter, not inlined.
    expect(q.params).toContain("Paid Social");
    // Rule hosts ride as parameters too.
    expect(q.params).toContain("%.duckduckgo.com");
  });

  test("screen buckets the width column with an honest Unknown", () => {
    const q = render(screenCase(sql`w`));
    expect(q.sql).toContain("WHEN w IS NULL THEN 'Unknown'");
    expect(q.sql).toContain("WHEN w < 576 THEN 'Mobile'");
  });
});

describe("applyFilters: cross-target bridging", () => {
  test("entryPath on event metrics goes through the session EXISTS", () => {
    const q = render(
      applyFilters({ target: "event", filters: [{ dim: "entryPath", op: "is", value: "/" }] }),
    );
    expect(q.sql).toContain("EXISTS (SELECT 1 FROM analytics_session");
    expect(q.sql).toContain('"analytics_session"."id" = "analytics_event"."session_id"');
  });

  test("path on session metrics means 'visited that page' (pageviews only)", () => {
    const q = render(
      applyFilters({ target: "session", filters: [{ dim: "path", op: "is", value: "/x" }] }),
    );
    expect(q.sql).toContain("EXISTS (SELECT 1 FROM analytics_event ae");
    expect(q.params).toContain("pageview");
  });

  test("event isNot inverts the EXISTS: sessions that never triggered it", () => {
    const q = render(
      applyFilters({
        target: "session",
        filters: [{ dim: "event", op: "isNot", value: "signup" }],
      }),
    );
    expect(q.sql).toContain("NOT EXISTS");
    expect(q.sql).toContain("ae.name = $");
  });

  test("multiple filters AND together", () => {
    const q = render(
      applyFilters({
        target: "event",
        filters: [
          { dim: "country", op: "is", value: "DE" },
          { dim: "browser", op: "is", value: "Firefox" },
        ],
      }),
    );
    expect(q.sql).toContain('"analytics_event"."country" = $1');
    expect(q.sql).toContain('"analytics_event"."browser" = $2');
    expect(q.sql).toContain(" and ");
  });
});
