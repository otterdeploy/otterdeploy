/**
 * useProjectEvents — subscribe to the server's project event stream and
 * keep React Query caches fresh by reacting to push messages.
 *
 * Pattern (per https://tanstack.com/query/v5/docs/framework/react/guides/query-invalidation):
 *   1. The existing useQuery / useLiveQuery hooks own the data — we
 *      never store anything ourselves.
 *   2. Transport is the oRPC event-iterator
 *      (`orpc.project.events.stream`). Cookies ride along for auth, and
 *      `context.retry` opts the call into the client retry plugin's
 *      auto-reconnect — so this matches every other live stream in the
 *      app instead of being the one bespoke EventSource holdout.
 *   3. The server pushes typed, zod-validated events
 *      (`resource` / `task` / `container`). We switch on `event.kind`
 *      and call `queryClient.invalidateQueries` for the affected keys.
 *
 * Events carry IDs only — when the server has new data the appropriate
 * useQuery refetches and React Query handles deduping. We don't push
 * payloads through this channel so the stream bandwidth stays trivial.
 */

import { useEffect } from "react";

import { type ProjectId, type ResourceId } from "@otterdeploy/shared/id";
import { useQueryClient } from "@tanstack/react-query";

import { DEPENDENCIES_COLLECTION_KEY } from "@/features/projects/data/dependencies";
import { proxyRoutesCollection } from "@/features/projects/data/proxy-routes";
import {
  DEPLOYMENT_TASKS_COLLECTION_KEY,
  DEPLOYMENTS_COLLECTION_KEY,
} from "@/features/resources/data/deployments";
import { RESOURCE_COLLECTION_KEY } from "@/features/resources/data/resource";
import { SERVICE_TASKS_COLLECTION_KEY } from "@/features/resources/data/service-tasks";
import { orpc } from "@/shared/server/orpc";

/** Trailing window over which event-driven invalidations are coalesced.
 *  A deploy emits docker events in bursts (create/start/die per container),
 *  and every invalidation of an ACTIVE query refetches immediately — so
 *  without batching, a burst of N events cost N× `resource.list` +
 *  N× `serviceTasks` round trips within a second. One flush per window per
 *  key caps that at 1/s while keeping the UI effectively live. */
const INVALIDATE_BATCH_MS = 1_000;

export function useProjectEvents(projectId?: ProjectId | null): void {
  const qc = useQueryClient();

  useEffect(() => {
    if (!projectId) return;

    const ctrl = new AbortController();

    // Keyed by a stable string so repeat events for the same cache entry
    // collapse to one invalidation per flush.
    const pending = new Map<string, () => void>();
    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleInvalidate = (key: string, invalidate: () => void) => {
      pending.set(key, invalidate);
      flushTimer ??= setTimeout(() => {
        flushTimer = null;
        const batch = [...pending.values()];
        pending.clear();
        for (const run of batch) run();
      }, INVALIDATE_BATCH_MS);
    };

    // Per-resource invalidations. `resource.get` is a plain useQuery, so its
    // exact key works. The deployment history + per-deployment task views are
    // TanStack DB collections keyed by a PREFIX (["deployments"] /
    // ["deployment-tasks"]) — a bare orpc key never matches the collection's
    // key, so invalidate the prefix to actually refetch. Each call is a no-op
    // if no consumer is mounted.
    const bumpResource = (resourceId: ResourceId) => {
      scheduleInvalidate(`resource-get:${resourceId}`, () => {
        void qc.invalidateQueries({
          queryKey: orpc.project.resource.get.queryKey({
            input: { projectId, resourceId },
          }),
        });
      });
      scheduleInvalidate("deployments", () => {
        void qc.invalidateQueries({ queryKey: DEPLOYMENTS_COLLECTION_KEY });
      });
      scheduleInvalidate("deployment-tasks", () => {
        void qc.invalidateQueries({ queryKey: DEPLOYMENT_TASKS_COLLECTION_KEY });
      });
    };

    void (async () => {
      try {
        const stream = await orpc.project.events.stream.call(
          { projectId },
          { signal: ctrl.signal, context: { retry: Number.POSITIVE_INFINITY } },
        );
        for await (const event of stream) {
          if (ctrl.signal.aborted) break;

          // Routes are the one collection whose rows arrive whole, so they are
          // APPLIED rather than invalidated — no refetch, no round trip. That
          // is sound only because `proxyRoute.list` is a plain select: the row
          // the writer published is exactly what a reader would fetch. Every
          // other event carries ids and triggers a refetch, because its data is
          // derived server-side and a pushed copy would be stale.
          if (event.kind === "route") {
            if (event.action === "removed") {
              proxyRoutesCollection.utils.writeDelete(event.routeId);
              if (event.resourceId) bumpResource(event.resourceId);
            } else {
              // Upsert, not insert-or-update: a created row may already be
              // present from an optimistic write, and an updated row may be
              // absent if this tab never loaded that subset.
              proxyRoutesCollection.utils.writeUpsert(event.route);
              if (event.route.resourceId) bumpResource(event.route.resourceId as ResourceId);
            }
            continue;
          }

          bumpResource(event.resourceId);

          // The graph node's status / framework / replica rollup ride on the
          // project-wide collections (["resource"], ["service-tasks"]), which
          // are prefix-keyed. Invalidate their prefixes on EVERY resource event
          // — not just create/remove — so a live status or framework change
          // refreshes the node without waiting for the repair poll.
          // (Bare orpc keys never match a collection's ["resource", …] key.)
          scheduleInvalidate("resource", () => {
            void qc.invalidateQueries({ queryKey: RESOURCE_COLLECTION_KEY });
          });
          scheduleInvalidate("service-tasks", () => {
            void qc.invalidateQueries({ queryKey: SERVICE_TASKS_COLLECTION_KEY });
          });

          // Membership change also reshapes the dependency edges.
          if (
            event.kind === "resource" &&
            (event.action === "created" || event.action === "removed")
          ) {
            scheduleInvalidate("dependencies", () => {
              void qc.invalidateQueries({ queryKey: DEPENDENCIES_COLLECTION_KEY });
            });
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
      if (flushTimer) clearTimeout(flushTimer);
    };
  }, [projectId, qc]);
}
