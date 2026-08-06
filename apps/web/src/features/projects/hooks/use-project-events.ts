/**
 * Subscribe once to the multiplexed collection event stream for a project.
 *
 * Pattern (per https://tanstack.com/query/v5/docs/framework/react/guides/query-invalidation):
 *   1. Query Collections own the data.
 *   2. Transport is the root oRPC event iterator (`orpc.events.stream`).
 *      Cookies ride along for auth, and
 *      `context.retry` opts the call into the client retry plugin's
 *      auto-reconnect — so this matches every other live stream in the
 *      app instead of being the one bespoke EventSource holdout.
 *   3. `upsert` and `delete` apply authoritative rows directly. `resync`
 *      asks the named collection to run its own queryFn again — batched,
 *      see RESYNC_BATCH_MS.
 */

import { useEffect } from "react";

import { type ProjectId } from "@otterdeploy/shared/id";
import { useQueryClient } from "@tanstack/react-query";

import { dependenciesCollection } from "@/features/projects/data/dependencies";
import { proxyRoutesCollection } from "@/features/projects/data/proxy-routes";
import {
  deploymentTasksCollection,
  deploymentsCollection,
} from "@/features/resources/data/deployments";
import { resourceCollection } from "@/features/resources/data/resource";
import { serviceTasksCollection } from "@/features/resources/data/service-tasks";
import { createResyncBatcher } from "@/shared/lib/resync-batcher";
import { orpc } from "@/shared/server/orpc";

/** Trailing window over which resync refetches are coalesced. A deploy emits
 *  docker events in bursts (create/start/die per container), and every event
 *  fans out to several collection resyncs — each an immediate round trip.
 *  Without batching, a burst of N events cost N× `resource.list` +
 *  N× `serviceTasks` refetches within a second (the request storm of
 *  2026-08-05, ~200 req/min idle). One flush per window per collection caps
 *  that at 1/s while keeping the UI effectively live. Pushed rows
 *  (upsert/delete) are NOT batched — a direct write is free and carries the
 *  authoritative data. */
const RESYNC_BATCH_MS = 1_000;

export function useProjectEvents(projectId?: ProjectId | null): void {
  const qc = useQueryClient();

  useEffect(() => {
    if (!projectId) return;

    const ctrl = new AbortController();

    const batcher = createResyncBatcher(RESYNC_BATCH_MS);
    const scheduleResync = batcher.schedule;

    void (async () => {
      try {
        const stream = await orpc.events.stream.call(
          { projectId },
          { signal: ctrl.signal, context: { retry: Number.POSITIVE_INFINITY } },
        );
        for await (const event of stream) {
          if (ctrl.signal.aborted) break;

          if (event.op === "upsert") {
            proxyRoutesCollection.utils.writeUpsert(event.rows);
            continue;
          }

          if (event.op === "delete") {
            proxyRoutesCollection.utils.writeDelete(event.keys);
            continue;
          }

          switch (event.collection) {
            case "resources": {
              scheduleResync("resources", () => {
                void resourceCollection.utils.refetch();
              });
              // The detail panel's `project.resource.get` is a plain useQuery
              // outside any collection — keep it live for the affected
              // resource until it too rides a pushed-row collection.
              const resourceId = event.scope.resourceId;
              if (resourceId) {
                scheduleResync(`resource-get:${resourceId}`, () => {
                  void qc.invalidateQueries({
                    queryKey: orpc.project.resource.get.queryKey({
                      input: { projectId, resourceId },
                    }),
                  });
                });
                // The service header's live view (use-live-service) is a plain
                // useQuery too — keep it fresh from the stream so its poll can
                // stay a slow backstop. No-op for non-service resources.
                scheduleResync(`service-get:${resourceId}`, () => {
                  void qc.invalidateQueries({
                    queryKey: orpc.service.get.queryKey({
                      input: { projectId, resourceId },
                    }),
                  });
                });
              }
              break;
            }
            case "deployments":
              scheduleResync("deployments", () => {
                void deploymentsCollection.utils.refetch();
              });
              break;
            case "deployment-tasks":
              scheduleResync("deployment-tasks", () => {
                void deploymentTasksCollection.utils.refetch();
              });
              break;
            case "service-tasks":
              scheduleResync("service-tasks", () => {
                void serviceTasksCollection.utils.refetch();
              });
              break;
            case "dependencies":
              scheduleResync("dependencies", () => {
                void dependenciesCollection.utils.refetch();
              });
              break;
            case "manifest":
              // Partial-input key ({projectId} only) matches both the graph's
              // and the pending-changes bar's diff cache entries.
              scheduleResync("manifest", () => {
                void qc.invalidateQueries({
                  queryKey: orpc.project.manifest.diff.queryKey({ input: { projectId } }),
                });
                void qc.invalidateQueries({
                  queryKey: orpc.project.manifest.get.queryKey({ input: { id: projectId } }),
                });
                void qc.invalidateQueries({
                  queryKey: orpc.project.stack.diff.queryKey({ input: { projectId } }),
                });
              });
              break;
            case "previews":
              scheduleResync("previews", () => {
                void qc.invalidateQueries({
                  queryKey: orpc.project.previews.list.queryKey({ input: { projectId } }),
                });
              });
              break;
          }
        }
      } catch (err) {
        // The retry plugin reconnects on transient errors; reaching here
        // means the stream ended terminally (or the component unmounted).
        if (ctrl.signal.aborted) return;
        // eslint-disable-next-line no-console
        console.warn("[project-events] stream ended", err);
      }
    })();

    return () => {
      ctrl.abort();
      batcher.cancel();
    };
  }, [projectId, qc]);
}
