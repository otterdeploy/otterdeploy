/**
 * The Caddy event feed.
 *
 * The whole read path for the Events pane: the three-pass WHERE, the counts,
 * the facets, one cursor page, and a histogram over the same filtered set —
 * all driven by the single declaration in `events-table.ts`, which the client
 * filters with too.
 *
 * Two things differ from the audit feed beside it.
 *
 * The handler is built PER REQUEST, because the tenant scope is a set of
 * domain names rather than an id (see `events-table.ts`). The cost is one
 * closure; what it buys is that the scope cannot be stale. What it costs is
 * that `createFeedHandler`'s unmapped-key check now fires on the first request
 * instead of at import — still loudly, still before anything renders.
 *
 * And it reads only the DATABASE. The older `events.query` endpoint falls back
 * to the in-memory ring when persistence is off; a feed cannot, because every
 * part of it — the facets, the histogram, the cursor — is SQL. So the page
 * reports whether events are being collected at all rather than rendering an
 * empty table that blames the time range.
 */

import { db } from "@otterdeploy/db";
import { edgeEvent } from "@otterdeploy/db/schema";
import { env } from "@otterdeploy/env/server";
import { type ProjectId } from "@otterdeploy/shared/id";

import { eventPersistenceEnabled } from "../../edge-logs";
import { createFeedHandler, feedResponse } from "../../lib/table";
import {
  edgeEventColumnMap,
  edgeEventExtraSelect,
  edgeEventFilters,
  edgeEventScope,
} from "./events-table";
import { resolveHosts } from "./streams";

export interface EdgeEventFeedInput {
  filters: Record<string, unknown>;
  sort?: { key: string; desc: boolean } | null;
  cursor?: number | null;
  direction: "next" | "prev";
  size: number;
  includeFacets: boolean;
  projectId?: ProjectId;
  timeZone?: string;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asNullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/** A guard, not a cast: `domains` is a jsonb column and can hold anything. */
function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function toEpochMs(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  return typeof value === "number" ? value : Number.NaN;
}

/**
 * One row, keyed the way the client's columns are.
 *
 * `domains` is narrowed to the caller's own, matching what `redact` has always
 * done for the ring-backed query: the certificate line for the whole box shows
 * this tenant's names and no one else's. `hosts` needs no such treatment — the
 * intersection is built into the expression that produced it.
 *
 * `level` and `category` stay plain strings rather than the declared enums.
 * The columns are `text`, the writer is Caddy, and narrowing a foreign value
 * into a member of a union it is not would be laundering, not parsing. The
 * FILTER is held to the declared vocabulary; the display reports what is
 * actually stored.
 */
function toFeedRow(row: Record<string, unknown>, owned: ReadonlySet<string>) {
  return {
    id: String(row.id),
    ts: toEpochMs(row.ts),
    level: asString(row.level),
    category: asString(row.category),
    logger: asString(row.logger),
    msg: asString(row.msg),
    host: asNullableString(row.host),
    hosts: asStringArray(row.hosts),
    domains: asStringArray(row.domains).filter((domain) => owned.has(domain)),
    upstream: asNullableString(row.upstream),
    error: asNullableString(row.error),
    raw: asString(row.raw),
  };
}

/**
 * Whether this install is recording Caddy's operational log at all.
 *
 * `sinkConfigured` false means EDGE_LOG_SINK is unset, so Caddy's default
 * logger was never pointed at us and its TLS/ACME lifecycle goes to the
 * container's stderr. `persisting` false means the log IS arriving but only
 * into the in-memory ring, which this feed cannot read. Both render as an
 * empty table, and they are not the same problem, so the page is told which.
 */
function collection() {
  return { sinkConfigured: Boolean(env.EDGE_LOG_SINK), persisting: eventPersistenceEnabled() };
}

export async function runEdgeEventFeed(
  input: EdgeEventFeedInput,
  // Branded at the parameter instead of cast at the call: the org id comes off
  // an authenticated context that already carries the brand.
  orgId: Parameters<typeof resolveHosts>[0],
) {
  const owned = await resolveHosts(orgId, input.projectId);
  const ownedSet = new Set(owned);

  const feed = createFeedHandler({
    db,
    table: edgeEvent,
    filters: edgeEventFilters,
    columns: edgeEventColumnMap(owned),
    select: edgeEventExtraSelect,
    cursorKey: "ts",
    defaultSize: 50,
  });

  // Untrusted input, validated against the declaration rather than trusted:
  // unknown keys dropped, enum members checked against the declared set.
  const values = edgeEventFilters.coerce(input.filters);

  const page = await feed.execute({
    values,
    scope: edgeEventScope(owned),
    sort: input.sort ?? null,
    cursor: input.cursor ?? null,
    direction: input.direction,
    size: input.size,
    includeFacets: input.includeFacets,
  });

  const response = await feedResponse(page, {
    db,
    table: edgeEvent,
    timeColumn: edgeEvent.ts,
    categoryColumn: edgeEvent.level,
    includeFacets: input.includeFacets,
    toItem: (row) => toFeedRow(row, ownedSet),
  });

  return { ...response, ...collection() };
}
