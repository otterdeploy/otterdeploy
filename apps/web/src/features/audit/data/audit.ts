/**
 * Audit-log data layer.
 *
 * The audit feed is an awkward fit for a TanStack DB collection: `audit.list`
 * returns a server-aggregated, server-paginated envelope: `{ items, counts,
 * total }`: where `counts`/`total` are computed over the *whole* filtered set
 * and `q` is a free-text search across several columns. None of that lives on a
 * row. So we split the page's reads along the grain:
 *
 *   • rows  → this collection (live, queryable via `useLiveQuery`)
 *   • counts/total → a tiny companion `useQuery` in the route (server truth)
 *
 * The collection is on-demand and keyed by a single serialized *subset key*
 * (the filter selection). A live query adds `eq(a.key, …)`, which TanStack DB
 * forwards as `loadSubsetOptions`; `queryKey`/`queryFn` recover the key to fetch
 * and cache the right page, then stamp it back onto each row so the client-side
 * `eq` matches. One stamped scalar, same trick as `api-keys.ts`.
 */
import { persistedCollectionOptions } from "@tanstack/browser-db-sqlite-persistence";
import { createCollection } from "@tanstack/db";
import { parseLoadSubsetOptions, queryCollectionOptions } from "@tanstack/query-db-collection";
import * as z from "zod";

import { persistence } from "@/shared/db/sqlite-persistence";
import { parseCol } from "@/shared/lib/utils";
import { client, queryClient } from "@/shared/server/orpc";

/** Row shape, inferred from the contract so it can't drift from the server. */
type AuditListOutput = Awaited<ReturnType<typeof client.audit.list>>;
export type AuditEvent = AuditListOutput["items"][number];
export type Outcome = AuditEvent["outcome"];

/** Time-window presets for the range filter. `ms === 0` means "all time";
 *  "custom" reads the filter's own `from`/`to` date bounds instead. */
export const RANGES = [
  { id: "1h", label: "Last hour", ms: 60 * 60 * 1000 },
  { id: "12h", label: "Last 12 hours", ms: 12 * 60 * 60 * 1000 },
  { id: "24h", label: "Last 24 hours", ms: 24 * 60 * 60 * 1000 },
  { id: "7d", label: "Last 7 days", ms: 7 * 24 * 60 * 60 * 1000 },
  { id: "30d", label: "Last 30 days", ms: 30 * 24 * 60 * 60 * 1000 },
  { id: "90d", label: "Last 90 days", ms: 90 * 24 * 60 * 60 * 1000 },
  { id: "all", label: "All time", ms: 0 },
  { id: "custom", label: "Custom range", ms: 0 },
] as const;

/** The filter selection: also the TanStack Form value shape. */
export interface AuditFilter {
  /** A `RANGES` id. */
  range: string;
  /** Custom-range bounds as `YYYY-MM-DD` date-input values; only read when
   *  `range === "custom"`. Empty string = unbounded on that side. */
  from: string;
  to: string;
  /** An `Outcome`, or "any" for no outcome filter. */
  outcome: string;
  /** An `actorId`, or "any". */
  actor: string;
  /** An action name (`<resource>.<verb>` RPC path), or "any". */
  action: string;
  /** A target kind ("project", "resource", …), or "any". */
  targetType: string;
  /** Free-text query. */
  q: string;
  /** Page size; bumped by "Load more". */
  limit: number;
}

export const DEFAULT_AUDIT_FILTER: AuditFilter = {
  range: "7d",
  from: "",
  to: "",
  outcome: "any",
  actor: "any",
  action: "any",
  targetType: "any",
  q: "",
  limit: 50,
};

/** Resolve the filter's time window into ISO `from`/`to` bounds. Custom uses
 *  the picked dates (inclusive, `to` extends to end-of-day, local time, since
 *  that's what a date picker means to a human). Presets look back from "now". */
export function auditWindow(filter: AuditFilter): { from?: string; to?: string } {
  if (filter.range === "custom") {
    return {
      from: filter.from ? new Date(`${filter.from}T00:00:00`).toISOString() : undefined,
      to: filter.to ? new Date(`${filter.to}T23:59:59.999`).toISOString() : undefined,
    };
  }
  const r = RANGES.find((x) => x.id === filter.range);
  return { from: !r || r.ms === 0 ? undefined : new Date(Date.now() - r.ms).toISOString() };
}

/** Mirrors the contract's `auditOutcomeSchema`; a drifted value degrades to
 *  "no outcome filter" instead of being cast into the input type. */
const outcomeSchema = z.enum(["success", "failure", "denied"]);

/** Resolve a filter selection into the `audit.list` input. */
export function toAuditInput(filter: AuditFilter) {
  const { from, to } = auditWindow(filter);
  return {
    q: filter.q.trim() || undefined,
    outcome: filter.outcome === "any" ? undefined : outcomeSchema.safeParse(filter.outcome).data,
    actorId: filter.actor === "any" ? undefined : filter.actor,
    action: filter.action === "any" ? undefined : filter.action,
    targetType: filter.targetType === "any" ? undefined : filter.targetType,
    from,
    to,
    limit: filter.limit,
    offset: 0,
  };
}

/**
 * Stable subset key for a filter selection. We key on the *range id*, not the
 * resolved `from` timestamp. `from` is recomputed from "now" on every render,
 * so keying on it would thrash the subset every frame. (The custom `from`/`to`
 * are static user-picked strings, so they're safe to key on directly.)
 */
export function auditSubsetKey(filter: AuditFilter): string {
  return JSON.stringify({
    range: filter.range,
    from: filter.range === "custom" ? filter.from : "",
    to: filter.range === "custom" ? filter.to : "",
    outcome: filter.outcome,
    actor: filter.actor,
    action: filter.action,
    targetType: filter.targetType,
    q: filter.q.trim(),
    limit: filter.limit,
  });
}

const subsetKeySchema = z.string().min(1);

/** Round-trip schema for `auditSubsetKey`: the key serializes every
 *  `AuditFilter` field, so parsing it back recovers the full filter. */
const auditFilterSchema: z.ZodType<AuditFilter> = z.object({
  range: z.string(),
  from: z.string(),
  to: z.string(),
  outcome: z.string(),
  actor: z.string(),
  action: z.string(),
  targetType: z.string(),
  q: z.string(),
  limit: z.number(),
});

/** Cache-key prefix for the rows collection: shared by the collection's
 *  `queryKey` and the loader prefetch below so they cannot drift. */
const AUDIT_COLLECTION_KEY = ["audit"] as const;

/**
 * Fetch one filter subset's rows and stamp the subset key back onto each row so
 * the live-query `eq(a.key, …)` matches client-side (rows are already
 * server-filtered). `counts`/`total` are dropped here: they're aggregates, not
 * row data; the route reads them from its companion query. Shared by the
 * collection's `queryFn` and `prefetchAuditSubset` (same cache entry).
 */
async function fetchAuditRows(key: string): Promise<AuditRow[]> {
  const filter: AuditFilter = auditFilterSchema.parse(JSON.parse(key));
  const data = await client.audit.list(toAuditInput(filter));
  return data.items.map((it) => ({ ...it, key }));
}

/**
 * Warm one filter subset's rows cache entry (route-loader intent-preload).
 * Non-blocking and best-effort: the collection's own subset query uses the
 * same key, so a warm entry makes the page's first load instant.
 */
export function prefetchAuditSubset(filter: AuditFilter): void {
  const key = auditSubsetKey(filter);
  void queryClient
    .prefetchQuery({
      queryKey: [...AUDIT_COLLECTION_KEY, key],
      queryFn: () => fetchAuditRows(key),
    })
    .catch(() => undefined);
}

const auditQueryOptions = queryCollectionOptions({
  // Stable id: persistedCollectionOptions keys the SQLite table off it; a
  // random per-load id would never round-trip (see project.ts).
  id: "audit",
  syncMode: "on-demand",
  queryKey: (opts) => {
    const base = [...AUDIT_COLLECTION_KEY];
    const { filters } = parseLoadSubsetOptions(opts);
    // Startup base-key call. Query-db-collection calls `queryKey({})` once to
    // compute the prefix every subset key extends. No filters yet.
    if (!filters.at(0)) return base;
    return [...base, parseCol(subsetKeySchema, filters, "key")];
  },
  queryFn: async (ctx) => {
    const { filters } = parseLoadSubsetOptions(ctx.meta?.loadSubsetOptions);
    if (!filters.at(0)) return [];
    const key = parseCol(subsetKeySchema, filters, "key");
    return fetchAuditRows(key);
  },
  queryClient,
  getKey: (item) => item.id,
  // Append-only feed: keep the page live without a manual refetch loop.
  refetchInterval: 15_000,
});

/** The subset-stamped row: an event plus the serialized filter key. */
type AuditRow = AuditEvent & { key: string };

// Call `createCollection` inside each branch. The persisted and plain option
// objects are different types (see project.ts for the full type note).
export const auditCollection = persistence
  ? createCollection(
      persistedCollectionOptions<AuditRow, string | number>({
        ...auditQueryOptions,
        persistence,
        schemaVersion: 1,
      }),
    )
  : createCollection(auditQueryOptions);
