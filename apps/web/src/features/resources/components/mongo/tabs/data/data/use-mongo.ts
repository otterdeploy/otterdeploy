/**
 * MongoDB data-viewer fetching hooks — the React-Query layer over
 * `database.mongoCollections` / `database.mongoDocuments`. `resourceId` is typed
 * `string` and cast to the branded oRPC input at the boundary, mirroring the
 * redis + postgres viewers.
 */
import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { orpc } from "@/shared/server/orpc";

/** Collections (with estimated counts) — drives the collection picker. */
export function useMongoCollections(resourceId: string) {
  return useQuery(
    orpc.database.mongoCollections.queryOptions({
      input: { resourceId: resourceId as never },
    }),
  );
}

/** One page of a collection's documents. Previous docs stay while paging. */
export function useMongoDocuments({
  resourceId,
  collection,
  limit,
  skip,
  enabled,
}: {
  resourceId: string;
  collection: string;
  limit: number;
  skip: number;
  enabled: boolean;
}) {
  return useQuery({
    ...orpc.database.mongoDocuments.queryOptions({
      input: { resourceId: resourceId as never, collection, limit, skip },
    }),
    enabled: enabled && Boolean(collection),
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}
