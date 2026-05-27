/**
 * useProjectEvents — subscribe to the server's project SSE stream and
 * keep React Query caches fresh by reacting to push messages.
 *
 * Pattern (per https://tanstack.com/query/v5/docs/framework/react/guides/query-invalidation):
 *   1. The existing useQuery / useLiveQuery hooks own the data — we
 *      never store anything ourselves.
 *   2. EventSource handles the transport. Browser-native: automatic
 *      reconnect with `Last-Event-ID`, no fetch/abort plumbing, cookies
 *      come along for auth.
 *   3. Server pushes typed events (`resource`, `task`, `container`).
 *      We `addEventListener` per type and call
 *      `queryClient.invalidateQueries` for the affected keys.
 *
 * Events carry IDs only — when the server has new data the appropriate
 * useQuery refetches and React Query handles deduping. We don't push
 * payloads through this channel so the SSE bandwidth stays trivial.
 */

import { useEffect } from "react";

import { useQueryClient } from "@tanstack/react-query";

import { env } from "@otterstack/env/web";
import type { ID_PREFIX, Id } from "@otterstack/shared/id";

import { orpc } from "@/shared/server/orpc";

type ProjectId = Id<typeof ID_PREFIX.project>;

interface ResourceEvent {
  kind: "resource";
  action: "created" | "updated" | "removed";
  resourceId: string;
}
interface TaskEvent {
  kind: "task";
  action: string;
  resourceId: string;
  taskId: string;
  state: string | null;
}
interface ContainerEvent {
  kind: "container";
  action: string;
  resourceId: string;
  containerId: string;
}

export function useProjectEvents(projectId: ProjectId | null | undefined): void {
  const qc = useQueryClient();

  useEffect(() => {
    if (!projectId) return;

    const url = sseUrl(projectId);
    const es = new EventSource(url, { withCredentials: true });

    // Per-resource invalidations — narrow to the affected resource's
    // queries so other resources' caches stay warm. Each call is a
    // no-op if no consumer is mounted.
    const bumpResource = (resourceId: string) => {
      void qc.invalidateQueries({
        queryKey: orpc.project.resource.get.queryKey({
          input: { projectId, resourceId: resourceId as never },
        }),
      });
      void qc.invalidateQueries({
        queryKey: orpc.project.resource.tasks.queryKey({
          input: { projectId, resourceId: resourceId as never },
        }),
      });
      void qc.invalidateQueries({
        queryKey: orpc.project.resource.deployments.list.queryKey({
          input: { projectId, resourceId: resourceId as never },
        }),
      });
    };

    es.addEventListener("resource", (e) => {
      const event = parse<ResourceEvent>(e);
      if (!event) return;
      bumpResource(event.resourceId);
      if (event.action === "created" || event.action === "removed") {
        // List membership changed — bounce the project-wide views so a
        // new card appears or a removed one disappears.
        void qc.invalidateQueries({
          queryKey: orpc.project.resource.list.queryKey({ input: { projectId } }),
        });
        void qc.invalidateQueries({
          queryKey: orpc.project.dependencies.queryKey({ input: { projectId } }),
        });
        void qc.invalidateQueries({
          queryKey: orpc.project.serviceTasks.queryKey({ input: { projectId } }),
        });
      }
    });

    es.addEventListener("task", (e) => {
      const event = parse<TaskEvent>(e);
      if (event) bumpResource(event.resourceId);
    });

    es.addEventListener("container", (e) => {
      const event = parse<ContainerEvent>(e);
      if (event) bumpResource(event.resourceId);
    });

    // Heartbeat & error frames — log only, EventSource auto-reconnects.
    es.addEventListener("error", () => {
      // EventSource will retry on its own using the browser default
      // (~3s with exponential growth). Log once per disconnect.
      // eslint-disable-next-line no-console
      if (es.readyState === EventSource.CLOSED) {
        console.warn("[project-events] stream closed by server");
      }
    });

    return () => {
      es.close();
    };
  }, [projectId, qc]);
}

function parse<T>(event: MessageEvent): T | null {
  try {
    return JSON.parse(event.data) as T;
  } catch {
    return null;
  }
}

function sseUrl(projectId: ProjectId): string {
  const base = env.VITE_SERVER_URL.replace(/\/$/, "");
  return `${base}/sse/projects/${encodeURIComponent(projectId)}/events`;
}
