/**
 * The edge access feed.
 *
 * The whole read path for the Access logs pane: the three-pass WHERE, the
 * counts, the facets, one cursor page, and a histogram over the same filtered
 * set — all driven by the single declaration in `access-table.ts`, which the
 * client filters with too.
 *
 * It reads only the DATABASE. The older `edgeLogs.query` falls back to the
 * in-memory ring when persistence is off; a feed cannot, because every part of
 * it is SQL. So the page reports whether traffic is being recorded at all
 * rather than rendering an empty table that blames the time range.
 */

import { db } from "@otterdeploy/db";
import { edgeLog } from "@otterdeploy/db/schema/edge-log";
import { env } from "@otterdeploy/env/server";
import { type ProjectId } from "@otterdeploy/shared/id";

import { persistenceEnabled } from "../../edge-logs";
import { computeHistogram, createFeedHandler, discoverRange } from "../../lib/table";
import {
  edgeAccessColumnMap,
  edgeAccessExtraSelect,
  edgeAccessFilters,
  edgeAccessScope,
  edgeAccessStatusClass,
} from "./access-table";
import { resolveHosts } from "./streams";

export interface EdgeAccessFeedInput {
  filters: Record<string, unknown>;
  sort?: { key: string; desc: boolean } | null;
  cursor?: number | null;
  direction: "next" | "prev";
  size: number;
  includeFacets: boolean;
  projectId?: ProjectId;
  timeZone?: string;
}

/**
 * The busiest fifty values per option list.
 *
 * `client_ip` and `path` run to five figures of distinct values over a day of
 * real traffic. Uncapped, the first page of every request would carry all of
 * them and the sidebar would render a list nobody can read — and the question
 * a facet list is actually for ("who is responsible for most of this") is
 * answered by the top of it. The counts still describe the whole set.
 */
const FACET_LIMIT = 50;

const feed = createFeedHandler({
  db,
  table: edgeLog,
  filters: edgeAccessFilters,
  columns: edgeAccessColumnMap(),
  select: edgeAccessExtraSelect,
  cursorKey: "ts",
  // See `edgeAccessColumnMap`: the PK is composite because the table is
  // partitioned, so the single-column default finds nothing.
  tiebreakKey: "id",
  defaultSize: 50,
  facetLimit: FACET_LIMIT,
});

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asNullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** A guard, not a cast: `headers` is a jsonb column and can hold anything. */
function asStringRecord(value: unknown): Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "string") out[key] = item;
  }
  return out;
}

function toEpochMs(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  return typeof value === "number" ? value : Number.NaN;
}

/** One row, keyed the way the client's columns are. */
function toFeedRow(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    ts: toEpochMs(row.ts),
    method: asString(row.method),
    status: asNumber(row.status),
    statusClass: asString(row.statusClass),
    host: asString(row.host),
    path: asString(row.path),
    clientIp: asString(row.clientIp),
    country: asNullableString(row.country),
    upstream: asNullableString(row.upstream),
    cache: asNullableString(row.cache),
    latencyMs: asNumber(row.latencyMs),
    userAgent: asString(row.userAgent),
    referer: asString(row.referer),
    // Computed by the SAME regex the client badge compiles, and carried on the
    // row so the two cannot drift into disagreeing about one request.
    suspicious: asString(row.suspicious),
    tlsVersion: asNullableString(row.tlsVersion),
    tlsCipher: asNullableString(row.tlsCipher),
    reqBytes: asNumber(row.reqBytes),
    resBytes: asNumber(row.resBytes),
    requestId: asNullableString(row.requestId),
    headers: asStringRecord(row.headers),
  };
}

/**
 * Whether this install is recording traffic at all.
 *
 * `sinkConfigured` false means EDGE_LOG_SINK is unset, so Caddy was never
 * pointed at us. `persisting` false means requests ARE arriving but only into
 * the in-memory ring, which this feed cannot read. Both render as an empty
 * table, and they are not the same problem, so the page is told which.
 */
function collection() {
  return { sinkConfigured: Boolean(env.EDGE_LOG_SINK), persisting: persistenceEnabled() };
}

export async function runEdgeAccessFeed(
  input: EdgeAccessFeedInput,
  // Branded at the parameter instead of cast at the call: the org id comes off
  // an authenticated context that already carries the brand.
  orgId: Parameters<typeof resolveHosts>[0],
) {
  const owned = await resolveHosts(orgId, input.projectId);

  // Untrusted input, validated against the declaration rather than trusted:
  // unknown keys dropped, enum members checked against the declared set,
  // numeric ranges clamped to their declared bounds.
  const values = edgeAccessFilters.coerce(input.filters);

  const page = await feed.execute({
    values,
    scope: edgeAccessScope(owned),
    sort: input.sort ?? null,
    cursor: input.cursor ?? null,
    direction: input.direction,
    size: input.size,
    includeFacets: input.includeFacets,
  });

  const items = page.rows.map(toFeedRow);

  if (!input.includeFacets) {
    return {
      items,
      nextCursor: page.nextCursor,
      prevCursor: page.prevCursor,
      // Null, not a stand-in: this page did not ask, so it does not know.
      totalRowCount: null,
      filterRowCount: null,
      facets: {},
      ...collection(),
    };
  }

  // The histogram runs over the SAME predicates the page came from, so the bars
  // and the rows can never be describing two different queries.
  const range = await discoverRange({
    db,
    table: edgeLog,
    column: edgeLog.ts,
    where: page.where,
  });

  const histogram = range
    ? await computeHistogram({
        db,
        table: edgeLog,
        timeColumn: edgeLog.ts,
        // Four bands, not forty: `2xx`…`5xx` is what "is anything failing"
        // asks, and it is the key the legend filters on.
        categoryColumn: edgeAccessStatusClass,
        where: page.where,
        range,
      })
    : undefined;

  return {
    items,
    nextCursor: page.nextCursor,
    prevCursor: page.prevCursor,
    totalRowCount: page.totalRowCount,
    filterRowCount: page.filterRowCount,
    facets: page.facets,
    ...(histogram ? { histogram } : {}),
    ...collection(),
  };
}
