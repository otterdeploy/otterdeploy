/**
 * Container registry credentials for the active org. Org-global (the
 * server scopes `registry.list` to the active organization), so this is
 * an eager collection mirroring `projectCollection` — the page just reads
 * via a live query and mutates the collection.
 *
 * All four procedures exist on the contract; create/update return the
 * fresh view row, so we refetch after each to replace the optimistic
 * temp row with the server's canonical one (masked fields, normalized
 * host, server id). The row type is inferred from the list projection —
 * reference it elsewhere as `(typeof registryCollection.toArray)[number]`.
 */

import { createCollection } from "@tanstack/db";
import { queryCollectionOptions } from "@tanstack/query-db-collection";

import { orpc, queryClient } from "@/shared/server/orpc";

export const registryCollection = createCollection(
  queryCollectionOptions({
    ...orpc.registry.list.queryOptions({ input: undefined }),
    queryKey: orpc.registry.list.queryKey({ input: undefined }),
    queryFn: async () => orpc.registry.list.call(),
    onInsert: async ({ transaction }) => {
      await Promise.all(
        transaction.mutations.map(async (m) => {
          const row = m.modified;
          const result = await orpc.registry.create.call({
            displayName: row.displayName,
            host: row.host,
            username: row.username,
            // The plaintext password rides on the optimistic row via
            // metadata — it's never stored on the row itself.
            password: (m.metadata as { password: string }).password,
            authType: row.authType,
          });
          // The optimistic row used a temp id; refetch so the real row
          // (server id, normalized host, …) replaces it.
          void queryClient.invalidateQueries({
            queryKey: orpc.registry.list.queryKey({ input: undefined }),
          });
          return result;
        }),
      );
    },
    onUpdate: async ({ transaction }) => {
      await Promise.all(
        transaction.mutations.map(async (m) => {
          const c = m.changes;
          // Empty string password means "leave existing in place" — the
          // server treats "" the same as omitted, so forward it as-is when
          // present.
          const password = (m.metadata as { password?: string } | undefined)
            ?.password;
          const result = await orpc.registry.update.call({
            id: m.original.id,
            ...(c.displayName !== undefined && { displayName: c.displayName }),
            ...(c.username !== undefined && { username: c.username }),
            ...(c.authType !== undefined && { authType: c.authType }),
            ...(password !== undefined && password.length > 0 && { password }),
          });
          void queryClient.invalidateQueries({
            queryKey: orpc.registry.list.queryKey({ input: undefined }),
          });
          return result;
        }),
      );
    },
    onDelete: async ({ transaction }) => {
      await Promise.all(
        transaction.mutations.map((m) =>
          orpc.registry.delete.call({ id: m.original.id }),
        ),
      );
    },
    queryClient,
    getKey: (item) => item.id,
  }),
);
