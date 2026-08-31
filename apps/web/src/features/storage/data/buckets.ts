/**
 * The storage feature's data layer.
 *
 * Buckets are a COLLECTION (a stable, small, org-scoped list that several
 * surfaces read), while a listing is a paged query keyed by where you are —
 * a page of 200 keys out of a million is not a collection, and pretending it
 * is would mean holding a bucket's whole keyspace in memory to render a table.
 */
import type { InferRouterOutputs } from "@orpc/server";
import type { AppRouter } from "@otterdeploy/api/routers/index";

import { createCollection } from "@tanstack/db";
import { queryCollectionOptions } from "@tanstack/query-db-collection";
import { useLiveQuery } from "@tanstack/react-db";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";

import { orpc, queryClient } from "@/shared/server/orpc";

export type BucketRow = InferRouterOutputs<AppRouter>["storage"]["listBuckets"]["buckets"][number];

function createBucketCollection(organizationId: string) {
  return createCollection(
    queryCollectionOptions({
      id: `storage-buckets:${organizationId}`,
      queryKey: [...orpc.storage.listBuckets.queryKey({ input: {} }), { organizationId }],
      queryFn: async (): Promise<BucketRow[]> => {
        const { buckets } = await orpc.storage.listBuckets.call({});
        return buckets;
      },
      queryClient,
      getKey: (row) => row.id,
      staleTime: 60_000,
    }),
  );
}

const bucketCollections = new Map<string, ReturnType<typeof createBucketCollection>>();

function bucketCollectionFor(organizationId: string) {
  const existing = bucketCollections.get(organizationId);
  if (existing) return existing;
  const created = createBucketCollection(organizationId);
  bucketCollections.set(organizationId, created);
  return created;
}

export function useBuckets(organizationId: string) {
  const collection = bucketCollectionFor(organizationId);
  const { data, isLoading, isError } = useLiveQuery((q) => q.from({ b: collection }), [collection]);
  return { buckets: data ?? [], isLoading, isError };
}

/** All loaded pages for one point-in-time listing. */
export function useObjectListing(input: {
  bucketId: string;
  prefix: string;
  grouping: "folders" | "flat";
  enabled: boolean;
}) {
  const query = useInfiniteQuery({
    queryKey: [...orpc.storage.list.key(), input.bucketId, input.prefix, input.grouping],
    // Empty is an internal first-page sentinel; the contract receives null.
    initialPageParam: "",
    queryFn: ({ pageParam }) =>
      orpc.storage.list.call({
        bucketId: input.bucketId,
        prefix: input.prefix,
        grouping: input.grouping,
        continuationToken: pageParam === "" ? null : pageParam,
        maxKeys: 200,
      }),
    getNextPageParam: (last) => last.continuationToken ?? undefined,
    enabled: input.enabled && input.bucketId !== "",
    refetchOnWindowFocus: false,
  });

  const pages = query.data?.pages;
  const objects = new Map(pages?.flatMap((page) => page.objects).map((row) => [row.key, row]));
  const data = pages
    ? {
        prefixes: [...new Set(pages.flatMap((page) => page.prefixes))],
        objects: [...objects.values()],
        continuationToken: pages.at(-1)?.continuationToken ?? null,
        truncated: query.hasNextPage,
      }
    : undefined;

  return {
    data,
    error: query.error,
    fetchNextPage: query.fetchNextPage,
    hasNextPage: query.hasNextPage,
    isError: query.isError,
    isFetchingNextPage: query.isFetchingNextPage,
    refetch: query.refetch,
  };
}

/** Metadata for the preview pane. */
export function useObjectDetail(input: { bucketId: string; key: string | null }) {
  return useQuery({
    ...orpc.storage.stat.queryOptions({
      input: { bucketId: input.bucketId, key: input.key ?? "" },
    }),
    enabled: input.key !== null && input.key !== "",
    refetchOnWindowFocus: false,
  });
}
