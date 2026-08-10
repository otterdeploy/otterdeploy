/**
 * Subscribe once to the org-scoped event stream (`events.orgStream`) and
 * resync the org-wide surfaces it announces: the header activity pill, the
 * notification inbox, and the servers collection.
 *
 * Same discipline as useProjectEvents: the stream decides WHEN to refetch,
 * the queries own the data, and resyncs are batched so a burst of events
 * costs one round trip per surface. The polls on these surfaces are
 * dead-stream backstops, not the freshness mechanism.
 *
 * The server derives the stream key from the session's active organization.
 * The input is empty. The effect re-keys on the URL's org slug because that
 * is the client-visible mirror of an org switch.
 */

import { useEffect } from "react";

import { useQueryClient } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";

import { serverCollection } from "@/features/servers/data/server";
import { createResyncBatcher } from "@/shared/lib/resync-batcher";
import { orpc } from "@/shared/server/orpc";

/** Keep in step with useProjectEvents' INVALIDATE_BATCH_MS. */
const RESYNC_BATCH_MS = 1_000;

export function useOrgEvents(): void {
  const qc = useQueryClient();
  const params = useParams({ strict: false }) as { orgSlug?: string };
  const orgSlug = params.orgSlug;

  useEffect(() => {
    if (!orgSlug) return;

    const ctrl = new AbortController();

    const batcher = createResyncBatcher(RESYNC_BATCH_MS);
    const scheduleResync = batcher.schedule;

    void (async () => {
      try {
        const stream = await orpc.events.orgStream.call(
          {},
          { signal: ctrl.signal, context: { retry: Number.POSITIVE_INFINITY } },
        );
        for await (const event of stream) {
          if (ctrl.signal.aborted) break;

          switch (event.collection) {
            case "activity":
              scheduleResync("activity", () => {
                void qc.invalidateQueries({ queryKey: orpc.deployment.activity.key() });
                // Prefix catches both the deployments page's filtered query
                // and the status pill's custom ["…", projectId, "app-status"]
                // cache entry (use-deploy-status.ts).
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
      } catch (err) {
        // The retry plugin reconnects on transient errors; reaching here
        // means the stream ended terminally (or the component unmounted).
        if (ctrl.signal.aborted) return;
        // eslint-disable-next-line no-console
        console.warn("[org-events] stream ended", err);
      }
    })();

    return () => {
      ctrl.abort();
      batcher.cancel();
    };
  }, [orgSlug, qc]);
}
