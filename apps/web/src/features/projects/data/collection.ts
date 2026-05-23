import { orpc, queryClient } from "@/shared/server/orpc";
import { createCollection } from "@tanstack/db";
import { queryCollectionOptions } from "@tanstack/query-db-collection";

export const projectCollection = createCollection(
  queryCollectionOptions({
    ...orpc.project.list.queryOptions(),
    queryKey: orpc.project.list.queryKey(),
    queryFn: async () => orpc.project.list.call(),
    queryClient,
    getKey: (item) => item.id,
  }),
);
