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
 */
import { omitUndefined } from "@otterdeploy/shared/object";
import { createCollection } from "@tanstack/db";
import { queryCollectionOptions } from "@tanstack/query-db-collection";
import { useLiveQuery } from "@tanstack/react-db";
import { useMutation } from "@tanstack/react-query";

import { metadataSecret } from "@/shared/db/mutation-metadata";
import { orpc, queryClient } from "@/shared/server/orpc";

export interface DataConnection {
  id: string;
  name: string;
  engine: "postgres" | "mariadb";
  /** Host and database only — enough to identify it, no credential. */
  displayHost: string;
  displayDatabase: string;
  visibility: "org" | "private";
  environment: "production" | "other";
  defaultAccess: "read-only" | "read-write";
  requireTls: boolean;
  createdAt: Date;
  lastConnectedAt: Date | null;
}

const listKey = orpc.data.listConnections.queryKey({ input: {} });

export const connectionsCollection = createCollection(
  queryCollectionOptions({
    id: "data-connections",
    queryKey: listKey,
    queryFn: async (): Promise<DataConnection[]> => {
      const { connections } = await orpc.data.listConnections.call({});
      return connections;
    },
    queryClient,
    getKey: (row) => row.id,
    onInsert: async ({ transaction }) => {
      await Promise.all(
        transaction.mutations.map(async (m) => {
          const row = m.modified;
          // The URL rides the mutation's metadata rather than the row, because
          // it is write-only: it must never end up in the collection's cached
          // data, where every reader of the list would hold a live credential.
          const url = metadataSecret(m.metadata);
          if (url === undefined) return;
          await orpc.data.createConnection.call({
            name: row.name,
            url,
            visibility: row.visibility,
            environment: row.environment,
            defaultAccess: row.defaultAccess,
            requireTls: row.requireTls,
          });
          // The optimistic row carried a temp id; refetch so the server's row
          // (real id, parsed host, timestamps) replaces it.
          await queryClient.invalidateQueries({ queryKey: listKey });
        }),
      );
    },
    onUpdate: async ({ transaction }) => {
      await Promise.all(
        transaction.mutations.map(async (m) => {
          const c = m.changes;
          const url = metadataSecret(m.metadata);
          await orpc.data.updateConnection.call({
            id: m.original.id,
            ...omitUndefined({
              name: c.name,
              visibility: c.visibility,
              environment: c.environment,
              defaultAccess: c.defaultAccess,
              requireTls: c.requireTls,
              // Omitting `url` leaves the stored credential untouched, which is
              // what lets someone rename a connection without re-pasting it.
              url,
            }),
          });
          await queryClient.invalidateQueries({ queryKey: listKey });
        }),
      );
    },
    onDelete: async ({ transaction }) => {
      await Promise.all(
        transaction.mutations.map((m) => orpc.data.deleteConnection.call({ id: m.original.id })),
      );
    },
    staleTime: 60_000,
  }),
);

export function useDataConnections() {
  const { data, isLoading } = useLiveQuery((q) => q.from({ c: connectionsCollection }), []);
  return { connections: data ?? [], isLoading };
}

/** Open the connection once and report what came back. */
export function useTestConnection() {
  return useMutation(orpc.data.testConnection.mutationOptions());
}
