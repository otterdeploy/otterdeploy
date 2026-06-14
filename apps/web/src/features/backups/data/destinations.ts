import type { destinationSchema } from "@otterdeploy/api/routers/backups/contract";
import { createCollection } from "@tanstack/db";
import { queryCollectionOptions } from "@tanstack/query-db-collection";
import type { z } from "zod";

import { orpc, queryClient } from "@/shared/server/orpc";

/**
 * Backup destinations (S3 / local disk / SFTP) for the active org. List/CRUD
 * ride the collection's own handlers; the page reads via a live query and
 * mutates the collection. The row type is inferred from the contract.
 *
 * Secrets are write-only — they never appear on a row — so create/update carry
 * them through the mutation's `metadata.secret` rather than a draft field.
 * `test` is a one-shot validation action (no row change), exported separately.
 */
export type Destination = z.infer<typeof destinationSchema>;

/** Write-only credential bag threaded through a mutation's metadata. */
interface DestinationSecretMeta {
  secret?: Record<string, string>;
}

const destinationsListKey = orpc.backups.destinations.list.queryKey();

export const destinationsCollection = createCollection(
  queryCollectionOptions({
    ...orpc.backups.destinations.list.queryOptions(),
    queryKey: destinationsListKey,
    queryFn: async () => orpc.backups.destinations.list.call({}),
    onInsert: async ({ transaction }) => {
      await Promise.all(
        transaction.mutations.map(async (m) => {
          const row = m.modified;
          const secret = (m.metadata as DestinationSecretMeta)?.secret;
          await orpc.backups.destinations.create.call({
            name: row.name,
            type: row.type,
            config: row.config,
            ...(secret && Object.keys(secret).length > 0 ? { secret } : {}),
          });
          // The optimistic row used a temp id; refetch so the real row
          // (server id, computed usage) replaces it.
          await queryClient.invalidateQueries({ queryKey: destinationsListKey });
        }),
      );
    },
    onUpdate: async ({ transaction }) => {
      await Promise.all(
        transaction.mutations.map((m) => {
          const c = m.changes;
          const secret = (m.metadata as DestinationSecretMeta)?.secret;
          return orpc.backups.destinations.update.call({
            id: m.original.id,
            ...(c.name !== undefined && { name: c.name }),
            ...(c.config !== undefined && { config: c.config }),
            ...(secret && Object.keys(secret).length > 0 ? { secret } : {}),
          });
        }),
      );
    },
    onDelete: async ({ transaction }) => {
      await Promise.all(
        transaction.mutations.map((m) =>
          orpc.backups.destinations.delete.call({ id: m.original.id }),
        ),
      );
    },
    queryClient,
    getKey: (d) => d.id,
  }),
);

/** Validate a destination's stored credential. Returns a human-readable note. */
export function testDestination(id: Destination["id"]) {
  return orpc.backups.destinations.test.call({ id });
}
