import { createCollection } from "@tanstack/db";
import { queryCollectionOptions } from "@tanstack/query-db-collection";

import { orpc, queryClient } from "@/shared/server/orpc";

/**
 * Notification channels + the event/channel subscription matrix for the viewed
 * organization. Both are org-scoped via the session (the procedures take no org
 * input), so each is a single eager collection — the page reads via a live
 * query and mutates the collection; no separate hooks.
 *
 * Pause and test are NOT collection mutations: `pause` flips a server-computed
 * status (active ⇆ paused, distinct from the derived `warn`/`disconnected`
 * states) and `test` has no row to mutate, so both stay direct
 * `client.notifications.channels.*` calls in the card.
 */

export const channelsCollection = createCollection(
  queryCollectionOptions({
    ...orpc.notifications.channels.list.queryOptions(),
    queryKey: orpc.notifications.channels.list.queryKey(),
    queryFn: async () => orpc.notifications.channels.list.call(),
    /**
     * `create` returns the persisted channel (server id, masked target,
     * computed stats). The optimistic row carries a temp id and placeholder
     * stats, so refetch after create so the real row replaces it in place.
     */
    onInsert: async ({ transaction }) => {
      await Promise.all(
        transaction.mutations.map(async (m) => {
          const row = m.modified;
          await orpc.notifications.channels.create.call({
            kind: row.kind,
            name: row.name,
            target: row.target,
            config: (row.config ?? {}) as Record<string, unknown>,
            // `secret` lives only in the insert metadata — it's never stored
            // on the row (the list never returns it).
            ...((m.metadata as { secret?: string } | undefined)?.secret
              ? { secret: (m.metadata as { secret: string }).secret }
              : {}),
          });
          void queryClient.invalidateQueries({
            queryKey: orpc.notifications.channels.list.queryKey(),
          });
        }),
      );
    },
    onUpdate: async ({ transaction }) => {
      await Promise.all(
        transaction.mutations.map((m) => {
          const c = m.changes as Partial<typeof m.original>;
          return orpc.notifications.channels.update.call({
            id: m.original.id,
            ...(c.name !== undefined && { name: c.name }),
            ...(c.target !== undefined && { target: c.target }),
            ...(c.config !== undefined && {
              config: c.config as Record<string, unknown>,
            }),
            // Secret is write-only — passed through the update metadata, never
            // held on the row.
            ...((m.metadata as { secret?: string } | undefined)?.secret
              ? { secret: (m.metadata as { secret: string }).secret }
              : {}),
          });
        }),
      );
    },
    onDelete: async ({ transaction }) => {
      await Promise.all(
        transaction.mutations.map((m) =>
          orpc.notifications.channels.delete.call({ id: m.original.id }),
        ),
      );
    },
    queryClient,
    getKey: (item) => item.id,
  }),
);

/** Composite key for a subscription cell — one channel × one event. */
function subscriptionKey(s: { channelId: string; eventId: string }) {
  return `${s.channelId}:${s.eventId}`;
}

/**
 * The subscription matrix as a flat list of (channelId, eventId) rows — one row
 * per enabled cell. Toggling a cell on inserts a row (fires `toggle`
 * enabled:true); toggling off deletes it (fires `toggle` enabled:false).
 */
export const subscriptionsCollection = createCollection(
  queryCollectionOptions({
    ...orpc.notifications.subscriptions.list.queryOptions(),
    queryKey: orpc.notifications.subscriptions.list.queryKey(),
    queryFn: async () => orpc.notifications.subscriptions.list.call(),
    onInsert: async ({ transaction }) => {
      await Promise.all(
        transaction.mutations.map((m) =>
          orpc.notifications.subscriptions.toggle.call({
            channelId: m.modified.channelId,
            eventId: m.modified.eventId,
            enabled: true,
          }),
        ),
      );
    },
    onDelete: async ({ transaction }) => {
      await Promise.all(
        transaction.mutations.map((m) =>
          orpc.notifications.subscriptions.toggle.call({
            channelId: m.original.channelId,
            eventId: m.original.eventId,
            enabled: false,
          }),
        ),
      );
    },
    queryClient,
    getKey: subscriptionKey,
  }),
);
