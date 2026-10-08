/**
 * What the edge access feed can be filtered by — declared once, on the server.
 *
 * The client imports these specs to build its controls, and the handler
 * compiles the very same declarations into SQL. Same arrangement as
 * `events-table.ts` next door, and for the same reason: the host scope is a
 * set of domain names resolved per request, not a column, so the column map is
 * a function of it.
 *
 * `edge_log` is the one table in the product drizzle-kit does not manage. It is
 * RANGE-partitioned by `ts` (see `edge-logs/partition.ts`), which the schema DSL
 * cannot express; the typed object exists for queries like these.
 */

import { edgeLog } from "@otterdeploy/db/schema/edge-log";
import { defineFilters, type FilterSpec } from "@otterdeploy/shared/table-filters";
import { inArray, sql, type SQL } from "drizzle-orm";

import type { ColumnMap } from "../../lib/table";

import { THREAT_SQL_REGEX } from "../../edge-logs/threat";

const METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"] as const;
const STATUS_CLASSES = ["2xx", "3xx", "4xx", "5xx"] as const;

export const edgeAccessFilterSpecs: readonly FilterSpec[] = [
  { key: "ts", type: "timerange", kind: "instant" },
  { key: "method", type: "checkbox", kind: "enum", options: [...METHODS] },
  /**
   * The exact code, faceted — `404 1,208 · 200 96 · 502 3` is the answer an
   * operator is usually after, and the old view's four chips could not give it.
   */
  { key: "status", type: "checkbox", kind: "number" },
  /**
   * The class, derived. Four bands is what the histogram can draw and what
   * "is anything failing" is actually asking, so this is the key its legend
   * writes to — clicking the red band filters to 5xx.
   */
  { key: "statusClass", type: "checkbox", kind: "enum", options: [...STATUS_CLASSES] },
  { key: "host", type: "checkbox", kind: "string" },
  { key: "clientIp", type: "checkbox", kind: "string" },
  { key: "country", type: "checkbox", kind: "string" },
  { key: "upstream", type: "checkbox", kind: "string" },
  { key: "cache", type: "checkbox", kind: "string" },
  { key: "latencyMs", type: "slider", kind: "number", min: 0, max: 5000 },
  /**
   * Scanner probes, derived from the SAME rule bodies the row badge uses.
   *
   * `THREAT_SQL_REGEX` and `classifyThreat` are two compilations of one list
   * (see `edge-logs/threat.ts`), so the set this filter counts is the set the
   * UI badges. The value travels ON the row as well, so the client evaluator
   * agrees with the WHERE clause about which requests are probes.
   */
  { key: "suspicious", type: "checkbox", kind: "enum", options: ["yes", "no"] },
  {
    key: "q",
    type: "search",
    kind: "string",
    keys: ["path", "host", "clientIp", "userAgent", "referer"],
  },
];

export const edgeAccessFilters = defineFilters(edgeAccessFilterSpecs);

/**
 * Compared on `lower(host)`, as every other edge-log query is.
 *
 * Scope hosts are canonicalized (`edge-logs/host`) and new rows store a
 * canonical host, but rows written before that change carry mixed case. Lower()
 * lets them match without a backfill — and dropping it here would silently
 * narrow one tenant's history rather than erring.
 */
const scopeHost = sql`lower(${edgeLog.host})`;

export function edgeAccessScope(owned: readonly string[]): SQL[] {
  // `inArray` with an empty list compiles to a false constant, which is the
  // right answer: owning no domains means seeing no requests.
  return [inArray(scopeHost, [...owned])];
}

/** `2xx`…`5xx`. The histogram's bands and the class filter, from one expression. */
const statusClass = sql<string>`(${edgeLog.status} / 100)::text || 'xx'`;

export { statusClass as edgeAccessStatusClass };

/**
 * Filter key → column, for one caller. Also the projection, so rows come back
 * keyed by these names and nothing maintains an inverse mapping.
 */
export function edgeAccessColumnMap(): ColumnMap {
  return {
    /**
     * In the column map, not the extra projection, because it is the TIEBREAK
     * and `resolveTiebreak` only looks here.
     *
     * `edge_log`'s primary key is composite `(id, ts)` — Postgres requires the
     * partition key in the PK of a partitioned table — so the feed's default
     * "the single-column primary key" finds nothing. `id` is still globally
     * unique: it is one `bigserial` shared by every partition, and the second
     * PK column is there for the partitioning, not for uniqueness.
     */
    id: edgeLog.id,
    ts: edgeLog.ts,
    method: edgeLog.method,
    status: edgeLog.status,
    statusClass,
    host: edgeLog.host,
    path: edgeLog.path,
    clientIp: edgeLog.clientIp,
    country: edgeLog.country,
    upstream: edgeLog.upstream,
    cache: edgeLog.cache,
    latencyMs: edgeLog.latencyMs,
    userAgent: edgeLog.userAgent,
    referer: edgeLog.referer,
    suspicious: sql<string>`case when ${edgeLog.path} ~* ${THREAT_SQL_REGEX} then 'yes' else 'no' end`,
  };
}

/**
 * Whether a probe "hit" was really the app's index page.
 *
 * A single-page app answers every unknown path with its `index.html`, so a
 * scanner asking for `/.env` or `/.git/config` gets a 200, and the row read as
 * a leaked secret. The access log does not record the response's content type,
 * but it does record its size: when a probe's 2xx body is byte-for-byte the
 * size the same host served for `/` within a day of it, the probe got the
 * index page and the file was never served.
 *
 * Only probe paths with a 2xx and a body are checked, so the correlated lookup
 * runs for a handful of rows per page, on the `(host, ts)` index. A real
 * secret file that happens to be exactly the index page's size would be
 * missed; the probe badge itself stays, so the row is never silent.
 */
/**
 * The root-document lookup, written out in full: drizzle prints a single-table
 * select's columns unqualified, and an unqualified `host` inside this
 * subquery would bind to the subquery's own row rather than the outer one. The
 * outer table is named explicitly, the inner one is aliased. A constant: no
 * input reaches it.
 */
const SAME_SIZE_AS_ROOT = sql.raw(`exists (
    select 1 from edge_log root_document
    where root_document.host = edge_log.host
      and root_document.path = '/'
      and root_document.status = 200
      and root_document.res_bytes = edge_log.res_bytes
      and root_document.ts between edge_log.ts - interval '1 day' and edge_log.ts + interval '1 day'
  )`);

const spaFallback = sql<boolean>`(
  ${edgeLog.status} between 200 and 299
  and ${edgeLog.resBytes} > 0
  and ${edgeLog.path} ~* ${THREAT_SQL_REGEX}
  and ${SAME_SIZE_AS_ROOT}
)`;

/** Columns the feed returns but nobody filters or sorts on. */
export const edgeAccessExtraSelect = {
  spaFallback,
  tlsVersion: edgeLog.tlsVersion,
  tlsCipher: edgeLog.tlsCipher,
  reqBytes: edgeLog.reqBytes,
  resBytes: edgeLog.resBytes,
  requestId: edgeLog.requestId,
  headers: edgeLog.headers,
};
