/**
 * The storage feature's data layer.
 *
 * Buckets are a COLLECTION (a stable, small, org-scoped list that several
 * surfaces read), while a listing is a paged query keyed by where you are —
 * a page of 200 keys out of a million is not a collection, and pretending it
 * is would mean holding a bucket's whole keyspace in memory to render a table.
 */
import { createCollection } from "@tanstack/db";
import { queryCollectionOptions } from "@tanstack/query-db-collection";
import { useLiveQuery } from "@tanstack/react-db";
import { useQuery } from "@tanstack/react-query";

import { orpc, queryClient } from "@/shared/server/orpc";

export interface BucketRow {
  id: string;
  name: string;
  bucket: string;
  region: string | null;
  endpoint: string | null;
  /** The prefix everything is scoped to; "" for the whole bucket. */
  root: string;
}

export const bucketsCollection = createCollection(
  queryCollectionOptions({
    id: "storage-buckets",
    queryKey: orpc.storage.listBuckets.queryKey({ input: {} }),
    queryFn: async (): Promise<BucketRow[]> => {
      const { buckets } = await orpc.storage.listBuckets.call({});
      return buckets;
    },
    queryClient,
    getKey: (row) => row.id,
    staleTime: 60_000,
  }),
);

export function useBuckets() {
  const { data, isLoading, isError } = useLiveQuery((q) => q.from({ b: bucketsCollection }), []);
  return { buckets: data ?? [], isLoading, isError };
}

/**
 * One page of a listing.
 *
 * `grouping` changes only how the SERVER groups the same keyspace, so switching
 * it re-queries but does not change what the view is looking at — which is why
 * the selection survives the toggle.
 */
export function useObjectListing(input: {
  bucketId: string;
  prefix: string;
  grouping: "folders" | "flat";
  continuationToken: string | null;
  enabled: boolean;
}) {
  return useQuery({
    ...orpc.storage.list.queryOptions({
      input: {
        bucketId: input.bucketId,
        prefix: input.prefix,
        grouping: input.grouping,
        continuationToken: input.continuationToken,
        maxKeys: 200,
      },
    }),
    enabled: input.enabled && input.bucketId !== "",
    // A listing is a point-in-time answer; refetching on focus would reshuffle
    // the table under a selection the user is still working with.
    refetchOnWindowFocus: false,
    placeholderData: (prev) => prev,
  });
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
