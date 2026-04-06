import { createCollection } from "@tanstack/react-db";
import { queryCollectionOptions } from "@tanstack/query-db-collection";
import { orpc, queryClient, client } from "@/utils/orpc";

export const envCollection = createCollection(
  queryCollectionOptions({
    ...orpc.env.list.queryOptions(),
    queryFn: async () => {
      console.log(orpc.env.list.queryKey());
      return orpc.env.list.call();
    },
    queryClient,
    getKey: (item) => item.id,
    onInsert: async ({ transaction }) => {
      await Promise.all(
        transaction.mutations.map((mutation, index) => {
          console.log(index);
          return client.env.create(mutation.modified);
        }),
      );
    },
  }),
);
