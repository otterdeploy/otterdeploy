/**
 * MariaDB data-viewer fetching hooks — the React-Query layer over
 * `database.mariadbTables` / `database.mariadbRows`. `resourceId` is typed
 * `string` and cast to the branded oRPC input at the boundary, mirroring the
 * redis + postgres viewers.
 */
import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { orpc } from "@/shared/server/orpc";

/** User tables in the database — drives the table picker. */
export function useMariadbTables(resourceId: string) {
  return useQuery(
    orpc.database.mariadbTables.queryOptions({
      input: { resourceId },
    }),
  );
}

/** One page of a table's rows. Previous rows stay on screen while paging. */
export function useMariadbRows({
  resourceId,
  schema,
  table,
  limit,
  offset,
  enabled,
}: {
  resourceId: string;
  schema: string;
  table: string;
  limit: number;
  offset: number;
  enabled: boolean;
}) {
  return useQuery({
    ...orpc.database.mariadbRows.queryOptions({
      input: { resourceId, schema, table, limit, offset },
    }),
    enabled: enabled && Boolean(table),
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}
