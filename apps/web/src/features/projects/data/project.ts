import { ID_PREFIX, createId } from "@otterdeploy/shared/id";
import { createCollection } from "@tanstack/db";
import { queryCollectionOptions } from "@tanstack/query-db-collection";

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

          // Env MUST be inserted standalone (projectId=null) — the project
          // row doesn't exist yet, so passing projectId here would violate
          // the environment.project_id FK. project.create below claims the
          // env by id and sets project_id server-side. We pass projectId:
          // null to the collection insert so the optimistic local row
          // matches what the server will actually persist; once
          // project.create returns we refetch the env list to pick up the
          // server-side link.
          const envTx = envCollection.insert({
            id: environmentId,
            projectId: null,
            name: "Development",
            slug: "development",
            createdAt: new Date(),
            updatedAt: new Date(),
          });
          await envTx.isPersisted.promise;

          const result = await orpc.project.create.call({
            id: projectId,
            environmentId,
            name: m.modified.name,
            slug: projectSlug,
          });

          // Refetch envs so the just-claimed environment shows projectId
          // set in the local store. Fire-and-forget — the project.create
          // resolution already unblocks the caller.
          void queryClient.invalidateQueries({
            queryKey: orpc.env.list.queryKey(),
          });

          return result;
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
