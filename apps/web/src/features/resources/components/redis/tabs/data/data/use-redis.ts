/**
 * Redis data-viewer fetching hooks — the React-Query layer over
 * `database.redisKeyspace` / `database.redisKeys` / `database.redisValue`.
 *
 * `resourceId` is typed `string` and cast to the branded oRPC input type at the
 * call boundary (`never` is assignable to any input type), mirroring the
 * postgres viewer's `use-database` hooks.
 */

import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { orpc } from "@/shared/server/orpc";

/** Per-database key counts — drives the db picker. */
export function useRedisKeyspace(resourceId: string) {
  return useQuery(
    orpc.database.redisKeyspace.queryOptions({
      input: { resourceId },
    }),
  );
}

/**
 * One SCAN page of keys for a db + match pattern. `cursor` advances paging;
 * previous keys stay on screen while the next page loads.
 */
export function useRedisKeys({
  resourceId,
  db,
  match,
  cursor,
  count,
}: {
  resourceId: string;
  db: number;
  match: string;
  cursor: string;
  count: number;
}) {
  return useQuery({
    ...orpc.database.redisKeys.queryOptions({
      input: { resourceId, db, match, cursor, count },
    }),
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}

/** Read one key's value (string or normalized grid). */
export function useRedisValue({
  resourceId,
  db,
  key,
  limit,
  enabled,
}: {
  resourceId: string;
  db: number;
  key: string | null;
  limit: number;
  enabled: boolean;
}) {
  return useQuery({
    ...orpc.database.redisValue.queryOptions({
      input: { resourceId, db, key: key ?? "", limit },
    }),
    enabled: enabled && Boolean(key),
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}
