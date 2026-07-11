import { createCollection } from "@tanstack/db";
import { queryCollectionOptions } from "@tanstack/query-db-collection";

import { orpc, queryClient } from "@/shared/server/orpc";

export const envCollection = createCollection(
  queryCollectionOptions({
    ...orpc.env.list.queryOptions(),
    queryKey: orpc.env.list.queryKey(),
    queryFn: async () => orpc.env.list.call(),
    onInsert: async ({ transaction }) => {
      await Promise.all(
        transaction.mutations.map((m) =>
          orpc.env.create.call({
            id: m.modified.id,
            name: m.modified.name,
            slug: m.modified.slug,
            projectId: m.modified.projectId ?? undefined,
          }),
        ),
      );
    },
    onDelete: async ({ transaction }) => {
      await Promise.all(
        transaction.mutations.map((m) => orpc.env.delete.call({ id: m.original.id })),
      );
    },
    queryClient,
    getKey: (item) => item.id,
  }),
);

export type EnvRow = Awaited<ReturnType<typeof orpc.env.list.call>>[number];

/**
 * Optimistic row for a hand-created environment. Environments are purely
 * user-created contexts now — PR previews live in their own `preview` table
 * and never appear here. Keeps the two insert sites (create dialog + project
 * onboarding) in sync with the full `environment` row shape.
 */
export function newPersistentEnvRow(input: {
  id: EnvRow["id"];
  name: string;
  slug: string;
  projectId: EnvRow["projectId"];
}): EnvRow {
  return {
    ...input,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}
