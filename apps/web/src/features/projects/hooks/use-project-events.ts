/**
 * Subscribe once to the multiplexed collection event stream for a project.
 *
 * Pattern (per https://tanstack.com/query/v5/docs/framework/react/guides/query-invalidation):
 *   1. Query Collections own the data.
 *   2. Transport is the root oRPC event iterator (`orpc.events.stream`).
 *      Cookies ride along for auth, and
 *      `context.retry` opts the call into the client retry plugin's
 *      auto-reconnect, so this matches every other live stream in the
 *      app instead of being the one bespoke EventSource holdout.
 *   3. `upsert` and `delete` apply authoritative rows directly. `resync`
 *      asks the named collection to run its own queryFn again. Batched,
 *      see RESYNC_BATCH_MS.
 *   4. The bus has no replay cursor, so a reconnect (a dropped connection,
 *      or a hidden tab's released live socket coming back) resyncs every
 *      surface the stream feeds: whatever happened in between was missed.
 */

import type { CollectionEvent } from "@otterdeploy/api/routers/events/contract";

import { useEffect } from "react";

import { type ProjectId, type ResourceId } from "@otterdeploy/shared/id";
import { useQueryClient } from "@tanstack/react-query";
import { Result } from "better-result";

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
 *  fans out to several collection resyncs: each an immediate round trip.
 *  Without batching, a burst of N events cost N× `resource.list` +
 *  N× `serviceTasks` refetches within a second (the request storm of
 *  2026-08-05, ~200 req/min idle). One flush per window per collection caps
 *  that at 1/s while keeping the UI effectively live. Pushed rows
 *  (upsert/delete) are NOT batched. A direct write is free and carries the
 *  authoritative data. */
const RESYNC_BATCH_MS = 1_000;

type ResyncCollection = Extract<CollectionEvent, { op: "resync" }>["collection"];

/** Every collection a `resync` event can name. */
const RESYNC_COLLECTIONS = [
  "resources",
  "deployments",
  "deployment-tasks",
  "service-tasks",
  "dependencies",
  "manifest",
  "previews",
] as const satisfies readonly ResyncCollection[];

export function useProjectEvents(projectId?: ProjectId | null): void {
  const qc = useQueryClient();

  useEffect(() => {
    if (!projectId) return;

    const ctrl = new AbortController();

    const batcher = createResyncBatcher(RESYNC_BATCH_MS);
    const scheduleResync = batcher.schedule;

    const resyncResource = (resourceId: ResourceId) => {
      // The detail panel's `project.resource.get` is a plain useQuery outside
      // any collection: keep it live for the affected resource until it too
      // rides a pushed-row collection.
      scheduleResync(`resource-get:${resourceId}`, () => {
        void qc.invalidateQueries({
          queryKey: orpc.project.resource.get.queryKey({ input: { projectId, resourceId } }),
        });
      });
      // The service header's live view (use-live-service) is a plain useQuery
      // too: keep it fresh from the stream so its poll can stay a slow
      // backstop. No-op for non-service resources.
      scheduleResync(`service-get:${resourceId}`, () => {
        void qc.invalidateQueries({
          queryKey: orpc.service.get.queryKey({ input: { projectId, resourceId } }),
        });
      });
    };

    const resync = (collection: ResyncCollection) => {
      switch (collection) {
        case "resources":
          scheduleResync("resources", () => {
            void resourceCollection.utils.refetch();
          });
          break;
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
    };

    // Everything the stream feeds, after a gap in it.
    const resyncAll = () => {
      for (const collection of RESYNC_COLLECTIONS) resync(collection);
      scheduleResync("proxy-routes", () => {
        void proxyRoutesCollection.utils.refetch();
      });
      scheduleResync("resource-get:*", () => {
        void qc.invalidateQueries({ queryKey: orpc.project.resource.get.key() });
        void qc.invalidateQueries({ queryKey: orpc.service.get.key() });
      });
    };

    void (async () => {
      const consumed = await Result.tryPromise({
        try: async () => {
          const stream = await orpc.events.stream.call(
            { projectId },
            {
              signal: ctrl.signal,
              context: {
                retry: Number.POSITIVE_INFINITY,
                onRetry: () => (reconnected) => {
                  if (reconnected) resyncAll();
                },
              },
            },
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

            resync(event.collection);
            if (event.collection === "resources" && event.scope.resourceId) {
              resyncResource(event.scope.resourceId);
            }
          }
        },
        catch: (cause) => cause,
      });
      // The retry plugin reconnects on transient errors; reaching here means
      // the stream ended terminally (or the component unmounted).
      if (consumed.isErr() && !ctrl.signal.aborted) {
        // eslint-disable-next-line no-console
        console.warn("[project-events] stream ended", consumed.error);
      }
    })();

    return () => {
      ctrl.abort();
      batcher.cancel();
    };
  }, [projectId, qc]);
}
