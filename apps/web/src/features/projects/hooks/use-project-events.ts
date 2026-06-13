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

import { type ProjectId, type ResourceId } from "@otterdeploy/shared/id";

import { useEffect } from "react";

import { useQueryClient } from "@tanstack/react-query";

import { orpc } from "@/shared/server/orpc";

export function useProjectEvents(projectId?: ProjectId | null): void {
  const qc = useQueryClient();

  useEffect(() => {
    if (!projectId) return;

    const ctrl = new AbortController();

    // Per-resource invalidations — narrow to the affected resource's
    // queries so other resources' caches stay warm. Each call is a
    // no-op if no consumer is mounted.
    const bumpResource = (resourceId: ResourceId) => {
      void qc.invalidateQueries({
        queryKey: orpc.project.resource.get.queryKey({
          input: { projectId, resourceId },
        }),
      });
      void qc.invalidateQueries({
        queryKey: orpc.project.resource.tasks.queryKey({
          input: { projectId, resourceId },
        }),
      });
      void qc.invalidateQueries({
        queryKey: orpc.project.resource.deployments.list.queryKey({
          input: { projectId, resourceId },
        }),
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

          bumpResource(event.resourceId);

          // List membership changed — bounce the project-wide views so a
          // new card appears or a removed one disappears.
          if (
            event.kind === "resource" &&
            (event.action === "created" || event.action === "removed")
          ) {
            void qc.invalidateQueries({
              queryKey: orpc.project.resource.list.queryKey({
                input: { projectId },
              }),
            });
            void qc.invalidateQueries({
              queryKey: orpc.project.dependencies.queryKey({
                input: { projectId },
              }),
            });
            void qc.invalidateQueries({
              queryKey: orpc.project.serviceTasks.queryKey({
                input: { projectId },
              }),
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
    };
  }, [projectId, qc]);
}
