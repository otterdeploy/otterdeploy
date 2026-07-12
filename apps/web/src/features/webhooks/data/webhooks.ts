import { createCollection } from "@tanstack/db";
import { queryCollectionOptions } from "@tanstack/query-db-collection";

import { orpc, queryClient } from "@/shared/server/orpc";

/**
 * Outbound webhooks + inbound trigger endpoints for the viewed organization.
 * Both procedures are org-scoped via the session (no org input), so each is a
 * single eager collection read through live queries.
 *
 * Outbound rides the collection for create/update/delete (optimistic rows,
 * post-create refetch replaces the temp id). Inbound is a READ collection
 * only: `create` returns the one-time plaintext secret (a metadata side
 * channel would hide that contract), and pause/edit flip server-shaped rows —
 * so all inbound writes are direct `client.webhooks.inbound.*` calls followed
 * by `invalidateInbound()`. Deliveries are a plain polling query on the page
 * (append-only server data, nothing to mutate).
 */

export const outboundCollection = createCollection(
  queryCollectionOptions({
    ...orpc.webhooks.outbound.list.queryOptions(),
    queryKey: orpc.webhooks.outbound.list.queryKey(),
    queryFn: async () => orpc.webhooks.outbound.list.call(),
    onInsert: async ({ transaction }) => {
      await Promise.all(
        transaction.mutations.map(async (m) => {
          await orpc.webhooks.outbound.create.call({
            url: m.modified.url,
            events: m.modified.events,
          });
          // The optimistic row carries a temp id and empty stats — refetch so
          // the persisted row (server id, minted secret) replaces it.
          void queryClient.invalidateQueries({
            queryKey: orpc.webhooks.outbound.list.queryKey(),
          });
        }),
      );
    },
    onUpdate: async ({ transaction }) => {
      await Promise.all(
        transaction.mutations.map((m) => {
          const c = m.changes as Partial<typeof m.original>;
          return orpc.webhooks.outbound.update.call({
            id: m.original.id,
            ...(c.url !== undefined && { url: c.url }),
            ...(c.events !== undefined && { events: c.events }),
          });
        }),
      );
    },
    onDelete: async ({ transaction }) => {
      await Promise.all(
        transaction.mutations.map((m) => orpc.webhooks.outbound.delete.call({ id: m.original.id })),
      );
    },
    queryClient,
    getKey: (item) => item.id,
  }),
);

export const inboundCollection = createCollection(
  queryCollectionOptions({
    ...orpc.webhooks.inbound.list.queryOptions(),
    queryKey: orpc.webhooks.inbound.list.queryKey(),
    queryFn: async () => orpc.webhooks.inbound.list.call(),
    onDelete: async ({ transaction }) => {
      await Promise.all(
        transaction.mutations.map((m) => orpc.webhooks.inbound.delete.call({ id: m.original.id })),
      );
    },
    queryClient,
    getKey: (item) => item.id,
  }),
);

/** Refetch outbound webhooks (after pause — server-derived status). */
export function invalidateOutbound() {
  return queryClient.invalidateQueries({
    queryKey: orpc.webhooks.outbound.list.queryKey(),
  });
}

/** Refetch inbound endpoints (after direct create/update/pause calls). */
export function invalidateInbound() {
  return queryClient.invalidateQueries({
    queryKey: orpc.webhooks.inbound.list.queryKey(),
  });
}
