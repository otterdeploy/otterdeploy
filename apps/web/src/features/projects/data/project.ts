import { ID_PREFIX, createId } from "@otterdeploy/shared/id";
import { persistedCollectionOptions } from "@tanstack/browser-db-sqlite-persistence";
import { createCollection } from "@tanstack/db";
import { queryCollectionOptions } from "@tanstack/query-db-collection";

import { persistence } from "@/shared/db/sqlite-persistence";
import { orpc, queryClient } from "@/shared/server/orpc";

import { envCollection, newPersistentEnvRow } from "./env";

// SPIKE: `queryCollectionOptions` produces a `CollectionConfig` (with `sync` +
// mutation handlers). When client-side SQLite persistence is available we spread
// that config into `persistedCollectionOptions`, which layers an OPFS-backed
// wa-sqlite store underneath the same oRPC sync path — instant hydration on
// reload, no change to how mutations reach the server. Where OPFS is
// unavailable (tests, unsupported browsers) `persistence` is null and we use the
// plain in-memory query collection, so this is a safe, non-breaking wrapper.
const projectQueryOptions = queryCollectionOptions({
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
        const environmentId = m.modified.environmentId ?? createId(ID_PREFIX.environment);

        // Env MUST be inserted standalone (projectId=null) — the project
        // row doesn't exist yet, so passing projectId here would violate
        // the environment.project_id FK. project.create below claims the
        // env by id and sets project_id server-side. We pass projectId:
        // null to the collection insert so the optimistic local row
        // matches what the server will actually persist; once
        // project.create returns we refetch the env list to pick up the
        // server-side link.
        const envTx = envCollection.insert(
          newPersistentEnvRow({
            id: environmentId,
            projectId: null,
            name: "Development",
            slug: "development",
          }),
        );
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
    // The collection's row shape includes server-managed fields
    // (createdAt, stackFile, lastAppliedAt, …) that the update input
    // doesn't accept. Pick only the user-settable fields so the spread
    // doesn't trip the input's strict shape.
    await Promise.all(
      transaction.mutations.map((m) => {
        const c = m.changes as Partial<typeof m.original>;
        return orpc.project.update.call({
          id: m.original.id,
          ...(c.name !== undefined && { name: c.name }),
          ...(c.slug !== undefined && { slug: c.slug }),
          ...(c.customDomain !== undefined && { customDomain: c.customDomain }),
        });
      }),
    );
  },
  queryClient,
  getKey: (item) => item.id,
});

type ProjectRow = Awaited<ReturnType<typeof orpc.project.list.call>>[number];

// Call `createCollection` inside each branch: the persisted and plain option
// objects are different types, so a single call over a ternary matches no
// `createCollection` overload. We also pin `persistedCollectionOptions`'s
// generics to `<ProjectRow, string>` — spreading the query options otherwise
// makes it re-infer `TSchema` as `StandardSchemaV1` (we pass no schema), which
// then fails `createCollection`'s `schema?: never` overload.
export const projectCollection = persistence
  ? createCollection(
      persistedCollectionOptions<ProjectRow, string | number>({
        ...projectQueryOptions,
        persistence,
        // Bump when the project row shape changes so the local SQLite table is
        // rebuilt from the server instead of serving a stale schema.
        // v2: added serviceCount / routeCount / runningServiceCount (#13). Without
        // this bump, persisted v1 rows lack those fields and the card renders a
        // stale "2/0 services · 0 routes".
        // v3: dropped previewsEnabled — the PR-preview opt-in moved to the
        // service (serviceResource.previewsEnabled, Source card).
        schemaVersion: 3,
      }),
    )
  : createCollection(projectQueryOptions);
