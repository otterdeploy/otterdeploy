/**
 * One infinite query per table, driven by the filter store.
 *
 * The decisions worth knowing:
 *
 * - **The query key is the filter set, and nothing else.** The cursor, the open
 *   row and live mode are excluded, so paging deeper, opening a detail sheet
 *   and tailing all read the same cache entry instead of throwing it away.
 * - **Aggregates ride the first page only.** Counts, facets and the histogram
 *   are computed over the whole filtered set, so they are identical on every
 *   page; asking for them again per page is work the server does not need to do
 *   and bytes the client already holds.
 * - **The page holding them is found by its page PARAM**, not by index. Live
 *   mode prepends pages, so index 0 is not always the page that carried them.
 * - **`keepPreviousData`** so changing a filter swaps the rows instead of
 *   flashing an empty table through a spinner and back.
 */

import { useMemo } from "react";

import { keepPreviousData, useInfiniteQuery } from "@tanstack/react-query";

import type { TableSort } from "@/shared/components/data-table/state/search-schema";

import type { FeedInput, FeedPage } from "./types";

interface PageParam {
  cursor: number | null;
  direction: "next" | "prev";
  /** The one page that asked for aggregates. */
  aggregates: boolean;
}

const FIRST_PAGE: PageParam = { cursor: null, direction: "next", aggregates: true };

export interface UseFeedOptions<TRow> {
  /**
   * Cache identity for this table's data. Filters and sort are appended to it.
   *
   * Anything `fetchPage` closes over that can change — a project id, a viewer's
   * time zone — belongs here too: the callback is re-read on every fetch, but
   * data already cached under this key is not re-fetched because it changed.
   */
  queryKey: readonly unknown[];
  fetchPage: (input: FeedInput) => Promise<FeedPage<TRow>>;
  filters: Record<string, unknown>;
  sort: TableSort | null;
  size?: number;
  enabled?: boolean;
  /** Poll for newer rows. */
  refetchInterval?: number | false;
}

export function useFeed<TRow>(options: UseFeedOptions<TRow>) {
  const { queryKey, fetchPage, filters, sort, size = 50, enabled = true } = options;

  // oxlint-disable-next-line eslint-tanstack-query/exhaustive-deps -- `fetchPage` is the caller's binding to one endpoint, not part of this data's identity; what it closes over belongs in `queryKey` (see below)
  const query = useInfiniteQuery({
    // The filter values and the sort ARE the identity of this data. Serialized
    // rather than spread, so a key stays one stable string as filters come and
    // go rather than changing arity.
    // `fetchPage` is deliberately absent: it is the caller's binding to one
    // endpoint, and keying on it would throw the cache away whenever a caller
    // rendered without memoizing it. What it closes over goes in `queryKey`.
    queryKey: [
      ...queryKey,
      JSON.stringify(filters),
      sort ? `${sort.key}.${sort.desc}` : null,
      size,
    ],
    enabled,
    initialPageParam: FIRST_PAGE,
    queryFn: ({ pageParam }) =>
      fetchPage({
        filters,
        sort,
        size,
        cursor: pageParam.cursor,
        direction: pageParam.direction,
        includeFacets: pageParam.aggregates,
      }),
    getNextPageParam: (lastPage): PageParam | undefined =>
      lastPage.nextCursor === null
        ? undefined
        : { cursor: lastPage.nextCursor, direction: "next", aggregates: false },
    getPreviousPageParam: (firstPage): PageParam | undefined =>
      firstPage.prevCursor === null
        ? undefined
        : { cursor: firstPage.prevCursor, direction: "prev", aggregates: false },
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
    refetchInterval: options.refetchInterval ?? false,
    staleTime: 30_000,
  });

  const pages = query.data?.pages;

  const rows = useMemo(() => pages?.flatMap((page) => page.items) ?? [], [pages]);

  /**
   * The page that carried the aggregates.
   *
   * Identified by its page param rather than by looking for non-empty facets:
   * a filter that legitimately matches nothing produces empty facets too, and
   * that heuristic would then read them off the wrong page.
   */
  const aggregates = useMemo(() => {
    if (!pages || pages.length === 0) return undefined;
    const params = query.data?.pageParams ?? [];
    const index = params.findIndex((param) =>
      typeof param === "object" && param !== null && "aggregates" in param
        ? Boolean(Reflect.get(param, "aggregates"))
        : false,
    );
    return pages[index] ?? pages[0];
  }, [pages, query.data?.pageParams]);

  return {
    rows,
    facets: aggregates?.facets ?? {},
    histogram: aggregates?.histogram,
    totalRowCount: aggregates?.totalRowCount ?? null,
    filterRowCount: aggregates?.filterRowCount ?? null,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError,
    error: query.error,
    hasNextPage: query.hasNextPage,
    isFetchingNextPage: query.isFetchingNextPage,
    fetchNextPage: query.fetchNextPage,
    fetchPreviousPage: query.fetchPreviousPage,
    refetch: query.refetch,
  };
}

/**
 * Whether another page would actually return rows.
 *
 * `hasNextPage` alone is not enough: it stays true until a fetch comes back
 * empty, so the button offers one more page after the last row and spends a
 * round trip proving there is nothing there. When the server reports how many
 * rows match, that count is authoritative and the offer stops one page early.
 */
export function canLoadMore(params: {
  hasNextPage: boolean;
  loaded: number;
  filterRowCount: number | null;
}): boolean {
  if (!params.hasNextPage) return false;
  if (params.filterRowCount === null) return true;
  return params.loaded < params.filterRowCount;
}
