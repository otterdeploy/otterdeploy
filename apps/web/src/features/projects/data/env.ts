import { createCollection } from "@tanstack/db";
import { queryCollectionOptions } from "@tanstack/query-db-collection";

import { orpc, queryClient } from "@/shared/server/orpc";

export const envCollection = createCollection(
  queryCollectionOptions({
    ...orpc.env.list.queryOptions(),
    queryKey: orpc.env.list.queryKey(),
    queryFn: async () => orpc.env.list.call(),
    onInsert: async ({ transaction }) => {
      await Promise.allSettled(
        transaction.mutations.map((m) =>
          orpc.env.create.call({
            id: m.modified.id,
            name: m.modified.name,
            slug: m.modified.slug,
          }),
        ),
      );
    },
    onDelete: async ({ transaction }) => {
      await Promise.allSettled(
        transaction.mutations.map((m) =>
          orpc.env.delete.call({ id: m.original.id }),
        ),
      );
    },
    queryClient,
    getKey: (item) => item.id,
  }),
);
