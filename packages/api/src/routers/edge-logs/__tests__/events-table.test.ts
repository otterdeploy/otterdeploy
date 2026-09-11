/**
 * What the Caddy event feed's tenant scope compiles to.
 *
 * `edge_event` has no organization column, so visibility is a predicate over
 * domain names — which makes this the one file standing between two tenants'
 * certificate logs. The cases below pin the three things that would each leak
 * or lose rows on their own.
 */

import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, test } from "vite-plus/test";

import { allOf, buildWhere } from "../../../lib/table/sql";
import { edgeEventColumnMap, edgeEventFilters, edgeEventScope } from "../events-table";

const dialect = new PgDialect();
const OWNED = ["api.mine.com", "www.mine.com"];

function render(owned: readonly string[], values: Record<string, unknown> = {}) {
  const where = allOf([
    ...edgeEventScope(owned),
    ...buildWhere(edgeEventFilters, edgeEventFilters.coerce(values), edgeEventColumnMap(owned)),
  ]);
  if (!where) return { sql: "", params: [] };
  const query = dialect.sqlToQuery(where);
  return { sql: query.sql.replace(/\s+/g, " ").trim(), params: query.params };
}

describe("host scope", () => {
  test("a row is in scope when it touches a domain the caller owns", () => {
    const out = render(OWNED);
    // The union of the row's own host and its certificate batch's domains…
    expect(out.sql).toContain('unnest( ARRAY["edge_event"."host"] ||');
    expect(out.sql).toContain('jsonb_array_elements_text("edge_event"."domains")');
    // …intersected with the caller's set, and non-empty.
    expect(out.sql).toContain("WHERE h = ANY(ARRAY[$1, $2]::text[])");
    expect(out.sql.startsWith("cardinality(")).toBe(true);
    expect(out.params).toEqual(OWNED);
  });

  test("owning nothing sees nothing", () => {
    // Not an error and not everything: `= ANY('{}')` is false for every row,
    // so the intersection is empty and `cardinality(...) > 0` excludes it.
    const out = render([]);
    expect(out.sql).toContain("WHERE h = ANY(ARRAY[]::text[])");
    expect(out.params).toEqual([]);
  });

  test("the host filter compiles against the SAME intersection as the scope", () => {
    // If these two ever drift, a facet list could offer a value the scope does
    // not admit — or, worse, admit one it does not offer.
    const out = render(OWNED, { hosts: ["www.mine.com"] });
    const intersections = out.sql.split("SELECT DISTINCT h").length - 1;
    expect(intersections).toBe(2);
    expect(out.sql).toContain("&& ARRAY[$5]::text[]");
    // The owned set is bound twice — once per intersection — and the reader's
    // chosen host last. Two copies, not one shared binding, because the scope
    // and the filter are separate clauses built from the same expression.
    expect(out.params).toEqual([...OWNED, ...OWNED, "www.mine.com"]);
  });

  test("a domain outside the owned set cannot be filtered into view", () => {
    // The literal still binds — `coerce` has no option list to check it
    // against — but it is matched against the INTERSECTION, which by
    // construction holds nothing the caller does not own.
    const out = render(OWNED, { hosts: ["other.tenant.com"] });
    expect(out.sql).toContain("WHERE h = ANY(ARRAY[$1, $2]::text[])");
    expect(out.params.at(-1)).toBe("other.tenant.com");
  });
});
