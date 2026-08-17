import type { destinationSchema } from "@otterdeploy/api/routers/backups/contract";
import type { z } from "zod";

import { omitUndefined } from "@otterdeploy/shared/object";
import { persistedCollectionOptions } from "@tanstack/browser-db-sqlite-persistence";
import { createCollection } from "@tanstack/db";
import { queryCollectionOptions } from "@tanstack/query-db-collection";

import { metadataSecretRecord } from "@/shared/db/mutation-metadata";
import { persistence } from "@/shared/db/sqlite-persistence";
import { orpc, queryClient } from "@/shared/server/orpc";

/**
 * Backup destinations (S3 / local disk / SFTP) for the active org. List/CRUD
 * ride the collection's own handlers; the page reads via a live query and
 * mutates the collection. The row type is inferred from the contract.
 *
 * Secrets are write-only (they never appear on a row) so create/update carry
 * them through the mutation's `metadata.secret` rather than a draft field.
 * `test` is a one-shot validation action (no row change), exported separately.
 */
export type Destination = z.infer<typeof destinationSchema>;

/**
 * Cast-free read of the write-only credential bag threaded through a
 * mutation's metadata. The shared `metadataSecret` reader covers single-string
 * secrets; destinations carry a whole record (access key + secret key, SFTP
 * password, …), so narrow that shape here with runtime checks, wrong or
 * missing metadata degrades to `undefined`.
 */

const destinationsListKey = orpc.backups.destinations.list.queryKey();

const destinationsQueryOptions = queryCollectionOptions({
  // Stable id: persistedCollectionOptions keys the SQLite table off it; a
  // random per-load id would never round-trip (see project.ts).
  id: "backup-destinations",
  ...orpc.backups.destinations.list.queryOptions(),
  queryKey: destinationsListKey,
  queryFn: async () => orpc.backups.destinations.list.call({}),
  onInsert: async ({ transaction }) => {
    await Promise.all(
      transaction.mutations.map(async (m) => {
        const row = m.modified;
        const secret = metadataSecretRecord(m.metadata);
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
        const secret = metadataSecretRecord(m.metadata);
        return orpc.backups.destinations.update.call({
          id: m.original.id,
          ...omitUndefined({ name: c.name, config: c.config }),
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
});

type DestinationRow = Awaited<ReturnType<typeof orpc.backups.destinations.list.call>>[number];

// Call `createCollection` inside each branch. The persisted and plain option
// objects are different types (see project.ts for the full type note).
export const destinationsCollection = persistence
  ? createCollection(
      persistedCollectionOptions<DestinationRow, string | number>({
        ...destinationsQueryOptions,
        persistence,
        schemaVersion: 1,
      }),
    )
  : createCollection(destinationsQueryOptions);

/** Validate a destination's stored credential. Returns a human-readable note. */
export function testDestination(id: Destination["id"]) {
  return orpc.backups.destinations.test.call({ id });
}

/**
 * Enable or disable a destination. Separate from the collection's `onUpdate`
 * because `status` isn't part of the update input, and because this is the only
 * mutation the platform-managed destination accepts, so it must not be coupled
 * to the config edit path that managed rows reject.
 *
 * Refetches rather than mutating optimistically: the server can refuse (it won't
 * let you disable the last active destination), and an optimistic flip would
 * briefly show a state the operator never gets.
 */
export async function setDestinationEnabled(id: Destination["id"], enabled: boolean) {
  const row = await orpc.backups.destinations.setEnabled.call({ id, enabled });
  await queryClient.invalidateQueries({ queryKey: destinationsListKey });
  return row;
}
