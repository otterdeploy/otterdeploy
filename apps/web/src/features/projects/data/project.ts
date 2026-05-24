import { createCollection } from "@tanstack/db";
import { queryCollectionOptions } from "@tanstack/query-db-collection";

import { createId, ID_PREFIX } from "@otterstack/shared/id";

import { orpc, queryClient } from "@/shared/server/orpc";

import { envCollection } from "./env";

export const projectCollection = createCollection(
  queryCollectionOptions({
    ...orpc.project.list.queryOptions(),
    queryKey: orpc.project.list.queryKey(),
    queryFn: async () => orpc.project.list.call(),
    /**
     * Creating a project also seeds a default environment. We do that as two
     * sequenced API calls from the client:
     *
     *   1. `envCollection.insert(...)` — optimistic env row + fires
     *      `env.create` on the server (standalone, projectId=null).
     *   2. Wait for the env to be persisted.
     *   3. `project.create({ environmentId, ... })` — server claims the
     *      standalone env by id and links it (`env.projectId = projectId`).
     *
     * The env shows up in `envCollection` immediately with `projectId` set
     * locally; the next refetch confirms the link from the server.
     */
    onInsert: async ({ transaction }) => {
      await Promise.all(
        transaction.mutations.map(async (m) => {
          const projectId = m.modified.id;
          const projectSlug = m.modified.slug;
          const environmentId =
            m.modified.environmentId ?? createId(ID_PREFIX.environment);

          const envTx = envCollection.insert({
            id: environmentId,
            projectId,
            name: "Development",
            slug: "development",
            createdAt: new Date(),
            updatedAt: new Date(),
          });
          await envTx.isPersisted.promise;

          return orpc.project.create.call({
            id: projectId,
            environmentId,
            name: m.modified.name,
            slug: projectSlug,
          });
        }),
      );
    },
    onUpdate: async ({ transaction }) => {
      await Promise.all(
        transaction.mutations.map((m) =>
          orpc.project.update.call({ ...m.changes, id: m.original.id }),
        ),
      );
    },
    queryClient,
    getKey: (item) => item.id,
  }),
);
