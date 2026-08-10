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

import { omitUndefined } from "@otterdeploy/shared/object";
import { persistedCollectionOptions } from "@tanstack/browser-db-sqlite-persistence";
import { createCollection } from "@tanstack/db";
import { queryCollectionOptions } from "@tanstack/query-db-collection";

import { persistence } from "@/shared/db/sqlite-persistence";
import { orpc, queryClient } from "@/shared/server/orpc";

/**
 * The plaintext password rides on the mutation's metadata side channel —
 * it's never stored on the row itself. `PendingMutation.metadata` is
 * `unknown`, so narrow at runtime instead of asserting a shape.
 */
function metadataPassword(metadata: unknown): string | undefined {
  if (typeof metadata !== "object" || metadata === null) return undefined;
  if ("password" in metadata && typeof metadata.password === "string") {
    return metadata.password;
  }
  return undefined;
}

const registryQueryOptions = queryCollectionOptions({
  // Stable id so the OPFS-backed SQLite table survives page loads — see
  // projectCollection for why persistence never round-trips without one.
  id: "registries",
  ...orpc.registry.list.queryOptions({ input: undefined }),
  queryKey: orpc.registry.list.queryKey({ input: undefined }),
  queryFn: async () => orpc.registry.list.call(),
  onInsert: async ({ transaction }) => {
    await Promise.all(
      transaction.mutations.map(async (m) => {
        const row = m.modified;
        const password = metadataPassword(m.metadata);
        if (password === undefined) {
          throw new Error("registry insert mutation is missing its password metadata");
        }
        const result = await orpc.registry.create.call({
          displayName: row.displayName,
          host: row.host,
          username: row.username,
          password,
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
        // server treats "" the same as omitted, so send it only when
        // non-empty ("" collapses to undefined and gets stripped).
        const password = metadataPassword(m.metadata);
        const result = await orpc.registry.update.call({
          id: m.original.id,
          ...omitUndefined({
            displayName: c.displayName,
            username: c.username,
            authType: c.authType,
            password: password || undefined,
          }),
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
      transaction.mutations.map((m) => orpc.registry.delete.call({ id: m.original.id })),
    );
  },
  queryClient,
  getKey: (item) => item.id,
});

type RegistryRow = Awaited<ReturnType<typeof orpc.registry.list.call>>[number];

// Two-branch createCollection + pinned generics — see projectCollection for why.
export const registryCollection = persistence
  ? createCollection(
      persistedCollectionOptions<RegistryRow, string | number>({
        ...registryQueryOptions,
        persistence,
        schemaVersion: 1,
      }),
    )
  : createCollection(registryQueryOptions);
