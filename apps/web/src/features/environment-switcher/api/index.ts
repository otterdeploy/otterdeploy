import { createCollection } from "@tanstack/react-db";
import { queryCollectionOptions } from "@tanstack/query-db-collection";
import { orpc, queryClient, client } from "@/utils/orpc";

export const envCollection = createCollection(
  queryCollectionOptions({
    ...orpc.env.all.queryOptions(),
    queryFn: async () => {
      console.log(orpc.env.all.queryKey());
      return await orpc.env.all.call();
    },
    queryClient,
    getKey: (item) => item.id,
    onInsert: async ({ transaction }) => {
      await Promise.all(
        transaction.mutations.map((mutation, index) => {
          console.log(index);
          return client.env.createEnv(mutation.modified);
        }),
      );
    },
  }),
);
