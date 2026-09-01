/**
 * External database connections, as a collection.
 *
 * A small, stable, org-scoped list that several surfaces read — the connection
 * switcher, the manage dialog, the command palette — which is exactly what a
 * TanStack DB collection is for. Mutations go through the collection's own
 * handlers so every reader updates without an invalidation fan-out.
 *
 * The URL is never in this data. It is write-only: it goes to the server on
 * create or update and no procedure ever returns it, so a row here can safely
 * be held in browser memory and rendered in a list.
 *
 * ROWS ARE PUSHED, NOT REFETCHED. Following
 * docs/designs/collection-cache-invalidation-api.md (whose reference
 * implementation is conar's `lib/sync.ts`): the mutation response is applied
 * directly with `writeUpsert`, the org event stream applies everyone else's
 * changes the same way, and the handlers return `{ refetch: false }`. There is
 * no `invalidateQueries` in this path — a list of five connections should not
 * cost a round trip to learn that one of them was renamed.
 *
 * The snapshot query is still the source of truth: it seeds the collection and
 * repairs it on reconnect. The stream is the incremental path between snapshots,
 * so a dropped event costs freshness, never correctness.
 */
import type { InferRouterOutputs } from "@orpc/server";
import type { AppRouter } from "@otterdeploy/api/routers/index";

import { omitUndefined } from "@otterdeploy/shared/object";
import { createCollection } from "@tanstack/db";
import { queryCollectionOptions } from "@tanstack/query-db-collection";
import { useLiveQuery } from "@tanstack/react-db";

import { metadataSecret } from "@/shared/db/mutation-metadata";
import { orpc, queryClient } from "@/shared/server/orpc";

export type DataConnection =
  InferRouterOutputs<AppRouter>["data"]["listConnections"]["connections"][number];

function createConnectionsCollection(organizationId: string) {
  return createCollection(
    queryCollectionOptions({
      id: `data-connections:${organizationId}`,
      queryKey: [...orpc.data.listConnections.queryKey({ input: {} }), { organizationId }],
      queryFn: async (): Promise<DataConnection[]> => {
        const { connections } = await orpc.data.listConnections.call({});
        return connections;
      },
      queryClient,
      getKey: (row) => row.id,
      onInsert: async ({ transaction }) => {
        for (const m of transaction.mutations) {
          const row = m.modified;
          // The URL rides the mutation's metadata rather than the row, because it
          // is write-only: it must never end up in the collection's cached data,
          // where every reader of the list would hold a live credential.
          const url = metadataSecret(m.metadata);
          if (url === undefined) continue;
          const saved = await orpc.data.createConnection.call({
            name: row.name,
            url,
            visibility: row.visibility,
            environment: row.environment,
            defaultAccess: row.defaultAccess,
            requireTls: row.requireTls,
            tags: row.tags,
          });
          // The optimistic row carried a temp id and no parsed host. Drop it and
          // write the server's row, rather than refetching the whole list to
          // discover the same thing the mutation just returned.
          const collection = connectionCollectionFor(organizationId);
          collection.utils.writeDelete(m.key);
          collection.utils.writeUpsert(saved);
        }
        return { refetch: false };
      },
      onUpdate: async ({ transaction }) => {
        for (const m of transaction.mutations) {
          const c = m.changes;
          const url = metadataSecret(m.metadata);
          const saved = await orpc.data.updateConnection.call({
            id: m.original.id,
            ...omitUndefined({
              name: c.name,
              visibility: c.visibility,
              environment: c.environment,
              defaultAccess: c.defaultAccess,
              requireTls: c.requireTls,
              tags: c.tags,
              // Omitting `url` leaves the stored credential untouched, which is
              // what lets someone rename a connection without re-pasting it.
              url,
            }),
          });
          connectionCollectionFor(organizationId).utils.writeUpsert(saved);
        }
        return { refetch: false };
      },
      onDelete: async ({ transaction }) => {
        await Promise.all(
          transaction.mutations.map((m) => orpc.data.deleteConnection.call({ id: m.original.id })),
        );
        // The optimistic delete already removed the row; there is nothing to
        // reconcile and nothing to refetch.
        return { refetch: false };
      },
      staleTime: 60_000,
    }),
  );
}

const connectionCollections = new Map<string, ReturnType<typeof createConnectionsCollection>>();

export function connectionCollectionFor(organizationId: string) {
  const existing = connectionCollections.get(organizationId);
  if (existing) return existing;
  const created = createConnectionsCollection(organizationId);
  connectionCollections.set(organizationId, created);
  return created;
}

export function useDataConnections(organizationId: string) {
  const collection = connectionCollectionFor(organizationId);
  const { data, isLoading } = useLiveQuery((q) => q.from({ c: collection }), [collection]);
  return { connections: data ?? [], isLoading };
}
