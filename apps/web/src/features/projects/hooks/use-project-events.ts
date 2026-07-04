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

import { orpc } from "@/shared/server/orpc";

export function useProjectEvents(projectId?: ProjectId | null): void {
  const qc = useQueryClient();

  useEffect(() => {
    if (!projectId) return;

    const ctrl = new AbortController();

    // Per-resource invalidations. `resource.get` is a plain useQuery, so its
    // exact key works. The deployment history + per-deployment task views are
    // TanStack DB collections keyed by a PREFIX (["deployments"] /
    // ["deployment-tasks"]) — a bare orpc key never matches the collection's
    // key, so invalidate the prefix to actually refetch. Each call is a no-op
    // if no consumer is mounted.
    const bumpResource = (resourceId: ResourceId) => {
      void qc.invalidateQueries({
        queryKey: orpc.project.resource.get.queryKey({
          input: { projectId, resourceId },
        }),
      });
      void qc.invalidateQueries({ queryKey: ["deployments"] });
      void qc.invalidateQueries({ queryKey: ["deployment-tasks"] });
    };

    void (async () => {
      try {
        const stream = await orpc.project.events.stream.call(
          { projectId },
          { signal: ctrl.signal, context: { retry: Number.POSITIVE_INFINITY } },
        );
        for await (const event of stream) {
          if (ctrl.signal.aborted) break;

          bumpResource(event.resourceId);

          // The graph node's status / framework / replica rollup ride on the
          // project-wide collections (["resource"], ["service-tasks"]), which
          // are prefix-keyed. Invalidate their prefixes on EVERY resource event
          // — not just create/remove — so a live status or framework change
          // refreshes the node immediately instead of waiting for the 30s poll.
          // (Bare orpc keys never match a collection's ["resource", …] key.)
          void qc.invalidateQueries({ queryKey: ["resource"] });
          void qc.invalidateQueries({ queryKey: ["service-tasks"] });

          // Membership change also reshapes the dependency edges.
          if (
            event.kind === "resource" &&
            (event.action === "created" || event.action === "removed")
          ) {
            void qc.invalidateQueries({ queryKey: ["dependencies"] });
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
    };
  }, [projectId, qc]);
}
