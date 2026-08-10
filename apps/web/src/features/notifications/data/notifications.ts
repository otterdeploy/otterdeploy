import { omitUndefined } from "@otterdeploy/shared/object";
import { persistedCollectionOptions } from "@tanstack/browser-db-sqlite-persistence";
import { createCollection } from "@tanstack/db";
import { queryCollectionOptions } from "@tanstack/query-db-collection";

import { metadataSecret } from "@/shared/db/mutation-metadata";
import { persistence } from "@/shared/db/sqlite-persistence";
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

const channelsQueryOptions = queryCollectionOptions({
  // Stable id so the OPFS-backed SQLite table survives page loads — see
  // projectCollection for why persistence never round-trips without one.
  id: "notifications-channels",
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
        // `secret` lives only in the insert metadata — it's never stored
        // on the row (the list never returns it). Truthiness gate: an
        // untouched form field is "", which is omitted, not sent.
        const secret = metadataSecret(m.metadata);
        await orpc.notifications.channels.create.call({
          kind: row.kind,
          name: row.name,
          target: row.target,
          config: row.config ?? {},
          ...(secret ? { secret } : {}),
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
        const c = m.changes;
        // Secret is write-only — passed through the update metadata, never
        // held on the row. Truthiness gate: an untouched form field is "",
        // which is omitted, not sent.
        const secret = metadataSecret(m.metadata);
        return orpc.notifications.channels.update.call({
          id: m.original.id,
          ...omitUndefined({ name: c.name, target: c.target, config: c.config }),
          ...(secret ? { secret } : {}),
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
});

type ChannelRow = Awaited<ReturnType<typeof orpc.notifications.channels.list.call>>[number];

// Two-branch createCollection + pinned generics — see projectCollection for why.
export const channelsCollection = persistence
  ? createCollection(
      persistedCollectionOptions<ChannelRow, string | number>({
        ...channelsQueryOptions,
        persistence,
        schemaVersion: 1,
      }),
    )
  : createCollection(channelsQueryOptions);

/** Composite key for a subscription cell — one channel × one event. */
function subscriptionKey(s: { channelId: string; eventId: string }) {
  return `${s.channelId}:${s.eventId}`;
}

/**
 * The subscription matrix as a flat list of (channelId, eventId) rows — one row
 * per enabled cell. Toggling a cell on inserts a row (fires `toggle`
 * enabled:true); toggling off deletes it (fires `toggle` enabled:false).
 */
const subscriptionsQueryOptions = queryCollectionOptions({
  id: "notifications-subscriptions",
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
});

type SubscriptionRow = Awaited<
  ReturnType<typeof orpc.notifications.subscriptions.list.call>
>[number];

export const subscriptionsCollection = persistence
  ? createCollection(
      persistedCollectionOptions<SubscriptionRow, string | number>({
        ...subscriptionsQueryOptions,
        persistence,
        schemaVersion: 1,
      }),
    )
  : createCollection(subscriptionsQueryOptions);
