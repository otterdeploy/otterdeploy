/**
 * What the Caddy event feed can be filtered by — declared once, on the server.
 *
 * The client imports these specs to build its controls, and the handler
 * compiles the very same declarations into SQL. Same arrangement as
 * `routers/audit/table.ts`, with one difference that shapes the whole file:
 * **the column map is a function, not a constant.**
 *
 * `edge_event` has no organization column. An event is visible to a caller
 * when its `host`, or any of its batch `domains`, is a domain that caller's
 * org owns (the rule `edge-logs/event-ring.ts` has always applied in memory).
 * That scope is a VALUE resolved per request, not a column to point at — so
 * the map that carries it cannot outlive the request either.
 */

import { edgeEvent } from "@otterdeploy/db/schema";
import { defineFilters, type FilterSpec } from "@otterdeploy/shared/table-filters";
import { sql, type SQL } from "drizzle-orm";

import type { ColumnMap } from "../../lib/table";

import { arrayExpr } from "../../lib/table";

/** The vocabulary Caddy's own logger writes, in severity order. */
const EVENT_LEVELS = ["debug", "info", "warn", "error"] as const;
/** Assigned by `edge-logs/event-parse.ts`, not by Caddy. */
const EVENT_CATEGORIES = ["cert", "upstream", "config", "other"] as const;

export const edgeEventFilterSpecs: readonly FilterSpec[] = [
  { key: "ts", type: "timerange", kind: "instant" },
  { key: "level", type: "checkbox", kind: "enum", options: [...EVENT_LEVELS] },
  { key: "category", type: "checkbox", kind: "enum", options: [...EVENT_CATEGORIES] },
  /**
   * ONE host list, over `host` ∪ `domains`.
   *
   * Two lists — one for the row's own host, one for a cert batch's domains —
   * would be the same names twice with the interesting rows split between
   * them: a certificate renewal for `api.example.com` carries `host = NULL`
   * and puts the name in `domains`, so a reader ticking `api.example.com`
   * under "Host" would get every upstream error for it and not one word about
   * its certificate. That is the row they opened this table to find.
   */
  { key: "hosts", type: "checkbox", kind: "array", itemKind: "string" },
  { key: "logger", type: "checkbox", kind: "string" },
  {
    key: "q",
    type: "search",
    kind: "string",
    keys: ["msg", "error", "logger", "host", "upstream", "raw"],
  },
];

export const edgeEventFilters = defineFilters(edgeEventFilterSpecs);

/** A `text[]` literal, for binding the owned-domain set. */
function textArray(values: readonly string[]): SQL {
  if (values.length === 0) return sql`ARRAY[]::text[]`;
  return sql`ARRAY[${sql.join(
    values.map((value) => sql`${value}`),
    sql`, `,
  )}]::text[]`;
}

/**
 * The hosts this row is attributable to AND this caller owns.
 *
 * The intersection is not an optimisation. Certificate management is batched
 * across the whole box, so one `cert` event can name domains belonging to
 * several tenants — and a facet list over the bare union would print the other
 * tenants' domain names, with counts, to anyone who owns one name in the
 * batch. Intersecting first means the expression can only ever produce names
 * the caller already knows.
 *
 * `DISTINCT` because a row whose `host` also appears in its `domains` would
 * otherwise count twice for that host in the facet list.
 *
 * `ARRAY[host]` is safe when `host` is NULL: it yields a one-element array
 * holding NULL, and NULL never satisfies `= ANY`, so the element drops out
 * here rather than needing a branch.
 *
 * Drizzle renders the two column refs unqualified when the outer query has no
 * join, which is correct here only because nothing inside can shadow them —
 * `unnest(...) AS h` is a single aliased value, not a table carrying its own
 * `host` and `domains`. Adding a join to this feed would qualify them, which
 * is also correct; adding a second `edge_event` to the FROM would not be.
 */
function ownedHostsExpr(owned: readonly string[]): SQL {
  const scope = textArray(owned);
  return sql`ARRAY(
    SELECT DISTINCT h
    FROM unnest(
      ARRAY[${edgeEvent.host}] ||
      ARRAY(SELECT jsonb_array_elements_text(${edgeEvent.domains}))
    ) AS h
    WHERE h = ANY(${scope})
  )`;
}

/**
 * The tenant scope, as one predicate.
 *
 * Deliberately the SAME expression the `hosts` filter compiles against: a row
 * is in scope exactly when the intersection above is non-empty. Writing the
 * scope as a second, independently-phrased predicate is how a visibility rule
 * and a filter drift apart, and on this table the visibility rule is the only
 * thing separating two tenants' certificate logs.
 */
export function edgeEventScope(owned: readonly string[]): SQL[] {
  return [sql`cardinality(${ownedHostsExpr(owned)}) > 0`];
}

/**
 * Filter key → column, for one caller. Also the projection, so rows come back
 * keyed by these names and nothing maintains an inverse mapping.
 */
export function edgeEventColumnMap(owned: readonly string[]): ColumnMap {
  return {
    ts: edgeEvent.ts,
    level: edgeEvent.level,
    category: edgeEvent.category,
    logger: edgeEvent.logger,
    msg: edgeEvent.msg,
    host: edgeEvent.host,
    upstream: edgeEvent.upstream,
    error: edgeEvent.error,
    raw: edgeEvent.raw,
    // `jsonb`, not `text[]`, and per-request besides — so it declares the array
    // type the `&&` cast and the facet `unnest` cannot read off a schema.
    hosts: arrayExpr(ownedHostsExpr(owned), "text[]"),
  };
}

/** Columns the feed returns but nobody filters or sorts on. */
export const edgeEventExtraSelect = {
  id: edgeEvent.id,
  domains: edgeEvent.domains,
};
