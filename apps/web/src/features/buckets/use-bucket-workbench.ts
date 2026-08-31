/**
 * The bucket workbench's controller: one state object, all of it in the URL.
 *
 * Split out of the components so the rule that makes the design work — the
 * breadcrumb, the prefix tree and the filter tokens are three editors of ONE
 * state — lives somewhere it can be read in one screen. The verbs (presign,
 * upload, delete…) live in `use-object-verbs`.
 *
 * Mounted per bucket (the route remounts on bucket change), so everything
 * held here — selection, paging — is scoped to one keyspace and dies with it.
 */
import { useMemo, useState } from "react";

import {
  compileStorageFilters,
  keyExtension,
  withStorageToken,
} from "@otterdeploy/shared/storage-filter";
import { Temporal } from "@otterdeploy/shared/temporal";

import { epochMsFromIso } from "@/shared/lib/clock";

import type { BucketRow } from "./data/buckets-data";
import type { BucketsSearch } from "./state";

import { useBucketStats, useObjectDetail, useObjectListing } from "./data/buckets-data";
import { ancestorPrefixes, crumbsFor } from "./state";
import { useObjectVerbs } from "./use-object-verbs";

/** A listed object plus the epoch-ms the filter grammar compares against. */
export interface ObjectRow {
  key: string;
  size: number;
  lastModified: string | null;
  modifiedMs: number | null;
  storageClass: string;
  eTag: string | null;
}

export function useBucketWorkbench({
  bucket,
  search,
  setSearch,
}: {
  bucket: BucketRow;
  search: BucketsSearch;
  setSearch: (next: Partial<BucketsSearch>) => void;
}) {
  // ── paging: a stack of continuation tokens, one per visited page ──────────
  // `pageTokens[i]` starts page i; page 0 starts from null. Prev pops, next
  // pushes — S3 offers no random access, so a stack is the honest model.
  const [pageTokens, setPageTokens] = useState<(string | null)[]>([null]);
  const pageIndex = pageTokens.length - 1;

  /** Selection is a Map key → size, so the bar can total what is ticked even
   *  after the rows scroll off through paging or prefix navigation. */
  const [selected, setSelected] = useState<ReadonlyMap<string, number>>(new Map());
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [statsOpen, setStatsOpen] = useState(true);

  const listing = useObjectListing({
    bucketId: bucket.id,
    prefix: search.prefix,
    grouping: search.grouping,
    continuationToken: pageTokens[pageIndex] ?? null,
    enabled: true,
  });
  const stats = useBucketStats({
    bucketId: bucket.id,
    prefix: search.prefix,
    q: search.q,
    enabled: true,
  });
  const detail = useObjectDetail({ bucketId: bucket.id, key: activeKey });

  // ── the one filter pipeline: tokens narrow the page the server returned ──
  // `nowMs` is frozen per query change so `modified:` tokens don't flicker
  // rows in and out across unrelated re-renders.
  const filters = useMemo(
    () => compileStorageFilters(search.q, Temporal.Now.instant().epochMilliseconds),
    [search.q],
  );
  const objects: ObjectRow[] = useMemo(() => {
    const rows = (listing.data?.objects ?? []).map((o) => ({
      ...o,
      modifiedMs: o.lastModified === null ? null : epochMsFromIso(o.lastModified),
    }));
    if (filters.length === 0) return rows;
    return rows.filter((o) => filters.every((f) => f.matches(o)));
  }, [listing.data, filters]);

  const prefixes = listing.data?.prefixes ?? [];

  // ── the rail's prefix tree: what this view can actually see ──────────────
  // S3 cannot enumerate a bucket's prefixes cheaply, so the tree is derived,
  // not discovered: the ancestors of where you stand, the prefixes on this
  // page, and the children the stats scan walked. Exactly what clicking one
  // will open — never a guess.
  const knownPrefixes = useMemo(() => {
    const set = new Set<string>(ancestorPrefixes(search.prefix));
    for (const p of listing.data?.prefixes ?? []) set.add(p);
    for (const child of stats.data?.childPrefixes ?? []) {
      set.add(`${search.prefix}${child.prefix}`);
    }
    return [...set].sort();
  }, [search.prefix, listing.data, stats.data]);

  // ── facets: the scan's aggregates, or the page's own when the scan has
  // not answered — the chips must exist the moment there are rows to filter,
  // not only once a 5,000-key walk completes. The fallback is labelled
  // "this page" so its counts are never read as the subtree's.
  const facets = useMemo(
    () => (stats.data === undefined ? pageFacetsOf(objects) : { ...stats.data, pageOnly: false }),
    [stats.data, objects],
  );

  /** Roll-ups for the prefix rows, from the stats scan: full prefix → tally. */
  const prefixTallies = useMemo(() => {
    const map = new Map<string, { count: number; bytes: number }>();
    for (const child of stats.data?.childPrefixes ?? []) {
      map.set(`${search.prefix}${child.prefix}`, { count: child.count, bytes: child.bytes });
    }
    return map;
  }, [stats.data, search.prefix]);

  // ── navigation: three editors, one state ─────────────────────────────────

  /**
   * Navigating closes the preview and resets paging but KEEPS the selection:
   * a bulk action spanning prefixes is a real thing to want, and silently
   * dropping keys someone ticked two folders ago is the worse surprise.
   */
  const navigateTo = (prefix: string) => {
    setActiveKey(null);
    setPageTokens([null]);
    setSearch({ prefix });
  };

  const setQuery = (q: string) => setSearch({ q });
  const toggleToken = (token: string) => setSearch({ q: withStorageToken(search.q, token) });
  const setGrouping = (grouping: "folders" | "flat") => {
    setPageTokens([null]);
    setSearch({ grouping });
  };

  const nextPage = () => {
    const token = listing.data?.continuationToken;
    if (token != null) setPageTokens((prev) => [...prev, token]);
  };
  const prevPage = () => {
    if (pageTokens.length > 1) setPageTokens((prev) => prev.slice(0, -1));
  };

  // ── selection ────────────────────────────────────────────────────────────

  const toggle = (key: string, size: number) =>
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(key)) next.delete(key);
      else next.set(key, size);
      return next;
    });

  const toggleAll = (next: boolean) =>
    setSelected(next ? new Map(objects.map((o) => [o.key, o.size])) : new Map());

  const clearSelection = () => setSelected(new Map());

  const selectedBytes = useMemo(
    () => [...selected.values()].reduce((sum, size) => sum + size, 0),
    [selected],
  );

  const verbs = useObjectVerbs({
    bucketId: bucket.id,
    prefix: search.prefix,
    selected,
    onDeleted: () => {
      clearSelection();
      setActiveKey(null);
    },
    refetchAll: () => {
      void listing.refetch();
      void stats.refetch();
    },
  });

  return {
    bucket,
    crumbs: crumbsFor(bucket.name, search.prefix),
    knownPrefixes,
    prefixes,
    prefixTallies,
    objects,
    listing,
    stats,
    facets,
    detail,
    statsOpen,
    toggleStats: () => setStatsOpen((v) => !v),
    pageIndex,
    nextPage,
    prevPage,
    hasNextPage: (listing.data?.continuationToken ?? null) !== null,
    selected,
    selectedBytes,
    activeKey,
    setActiveKey,
    navigateTo,
    setQuery,
    toggleToken,
    setGrouping,
    toggle,
    toggleAll,
    clearSelection,
    ...verbs,
  };
}

/**
 * Facets tallied from the loaded page, for when the stats scan has not
 * answered. Labelled `pageOnly` so its counts are never read as the
 * subtree's.
 */
function pageFacetsOf(objects: readonly ObjectRow[]) {
  if (objects.length === 0) return undefined;
  const staleCutoff = Temporal.Now.instant().epochMilliseconds - 365 * 86_400_000;
  const byClass = new Map<string, { count: number; bytes: number }>();
  const byExtension = new Map<string, { count: number; bytes: number }>();
  let largeCount = 0;
  let staleCount = 0;
  for (const o of objects) {
    const cls = byClass.get(o.storageClass) ?? { count: 0, bytes: 0 };
    cls.count += 1;
    cls.bytes += o.size;
    byClass.set(o.storageClass, cls);
    const ext = keyExtension(o.key);
    if (ext !== null) {
      const tally = byExtension.get(ext) ?? { count: 0, bytes: 0 };
      tally.count += 1;
      tally.bytes += o.size;
      byExtension.set(ext, tally);
    }
    if (o.size > 100_000_000) largeCount += 1;
    if (o.modifiedMs !== null && o.modifiedMs < staleCutoff) staleCount += 1;
  }
  return {
    byClass: [...byClass.entries()]
      .map(([storageClass, t]) => ({ storageClass, ...t }))
      .sort((a, b) => b.bytes - a.bytes),
    byExtension: [...byExtension.entries()]
      .map(([extension, t]) => ({ extension, ...t }))
      .sort((a, b) => b.count - a.count),
    largeCount,
    staleCount,
    scannedKeys: objects.length,
    complete: false,
    pageOnly: true,
  };
}
