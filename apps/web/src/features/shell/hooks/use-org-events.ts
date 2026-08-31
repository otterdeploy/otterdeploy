/**
 * Subscribe once to the org-scoped event stream (`events.orgStream`) and apply
 * what it announces.
 *
 * Two dispositions, and the event says which:
 *
 *   - `resync` names a surface; the query owns the data and refetches. Resyncs
 *     are batched so a burst of events costs one round trip per surface.
 *   - `upsert`/`delete` CARRY THE ROW; it is applied with
 *     `writeUpsert`/`writeDelete` and nothing refetches at all. Same discipline
 *     as useProjectEvents' proxy-route path, and the shape
 *     docs/designs/collection-cache-invalidation-api.md specifies.
 *
 * The polls on these surfaces are dead-stream backstops, not the freshness
 * mechanism.
 *
 * The server derives the stream key from the session's active organization.
 * The input is empty. The effect re-keys on the URL's org slug because that
 * is the client-visible mirror of an org switch.
 */

import { useEffect } from "react";

import { useQueryClient } from "@tanstack/react-query";
import { useLoaderData, useParams } from "@tanstack/react-router";
import { Result } from "better-result";

import { connectionCollectionFor } from "@/features/resources/components/postgres/tabs/data/data/connections";
import { serverCollection } from "@/features/servers/data/server";
import { createResyncBatcher } from "@/shared/lib/resync-batcher";
import { orpc } from "@/shared/server/orpc";

/** Keep in step with useProjectEvents' INVALIDATE_BATCH_MS. */
const RESYNC_BATCH_MS = 1_000;

export function useOrgEvents(): void {
  const qc = useQueryClient();
  const params = useParams({ strict: false });
  const orgSlug = params.orgSlug;
  const { organization } = useLoaderData({ from: "/_app/$orgSlug" });
  const connections = connectionCollectionFor(organization.id);

  useEffect(() => {
    if (!orgSlug) return;

    const ctrl = new AbortController();

    const batcher = createResyncBatcher(RESYNC_BATCH_MS);
    const scheduleResync = batcher.schedule;

    void (async () => {
      const consumed = await Result.tryPromise({
        try: async () => {
          const stream = await orpc.events.orgStream.call(
            {},
            { signal: ctrl.signal, context: { retry: Number.POSITIVE_INFINITY } },
          );
          // Redis pub/sub has no replay cursor. Every initial connection and
          // reconnect therefore takes a fresh snapshot before consuming the
          // incremental stream, repairing events missed while disconnected.
          void connections.utils.refetch();
          for await (const event of stream) {
            if (ctrl.signal.aborted) break;

            // Row-carrying events are applied directly. No batching: there is no
            // round trip to coalesce, and a write is cheaper than the timer.
            if (event.op === "upsert") {
              connections.utils.writeUpsert(event.rows);
              continue;
            }
            if (event.op === "delete") {
              connections.utils.writeDelete(event.keys);
              continue;
            }

            switch (event.collection) {
              case "activity":
                scheduleResync("activity", () => {
                  void qc.invalidateQueries({ queryKey: orpc.deployment.activity.key() });
                  void qc.invalidateQueries({ queryKey: orpc.deployment.listByProject.key() });
                });
                break;
              case "inbox":
                scheduleResync("inbox", () => {
                  void qc.invalidateQueries({ queryKey: orpc.notifications.inbox.list.key() });
                });
                break;
              case "servers":
                scheduleResync("servers", () => {
                  void serverCollection.utils.refetch();
                });
                break;
            }
          }
        },
        catch: (cause) => cause,
      });
      // The retry plugin reconnects on transient errors; reaching here means
      // the stream ended terminally (or the component unmounted).
      if (consumed.isErr() && !ctrl.signal.aborted) {
        // eslint-disable-next-line no-console
        console.warn("[org-events] stream ended", consumed.error);
      }
    })();

    return () => {
      ctrl.abort();
      batcher.cancel();
    };
  }, [connections, orgSlug, qc]);
}
