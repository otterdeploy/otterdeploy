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

import { type ProjectId, type ResourceId, zId } from "@otterdeploy/shared/id";

import { useEffect } from "react";

import { useQueryClient } from "@tanstack/react-query";

import { env } from "@otterdeploy/env/web";
import { orpc } from "@/shared/server/orpc";

import * as z from "zod/v4";

const resourceEventSchema = z.object({
  kind: z.literal("resource"),
  action: z.enum(["created", "updated", "removed"]),
  resourceId: zId("resource"),
});

const taskEventSchema = z.object({
  kind: z.literal("task"),
  action: z.string(),
  resourceId: zId("resource"),
  taskId: z.string(),
  state: z.string().nullable(),
});

const containerEventSchema = z.object({
  kind: z.literal("container"),
  action: z.string(),
  resourceId: zId("resource"),
  containerId: z.string(),
});

export function useProjectEvents(projectId?: ProjectId | null): void {
  const qc = useQueryClient();

  useEffect(() => {
    if (!projectId) return;

    const url = sseUrl(projectId);
    const es = new EventSource(url, { withCredentials: true });

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

    es.addEventListener("resource", (e) => {
      const event = parseEvent(e, resourceEventSchema);
      if (!event) return;
      bumpResource(event.resourceId);
      if (event.action === "created" || event.action === "removed") {
        // List membership changed — bounce the project-wide views so a
        // new card appears or a removed one disappears.
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
    });

    es.addEventListener("task", (e) => {
      const event = parseEvent(e, taskEventSchema);
      if (!event) return;
      bumpResource(event.resourceId);
    });

    es.addEventListener("container", (e) => {
      const event = parseEvent(e, containerEventSchema);
      if (!event) return;
      bumpResource(event.resourceId);
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

/**
 * Decode the SSE frame's `data` field and validate it against `schema`
 * in one shot. Returns the parsed value typed by the schema, or `null`
 * if the payload didn't parse as JSON or didn't match — errors are
 * logged once and swallowed so one malformed frame can't take down the
 * subscription.
 */
function parseEvent<TSchema extends z.ZodType>(
  e: MessageEvent,
  schema: TSchema,
): z.infer<TSchema> | null {
  let raw: unknown;
  try {
    raw = JSON.parse(e.data);
  } catch {
    return null;
  }
  const { data, error } = schema.safeParse(raw);
  if (error) {
    console.error("[project-events] invalid event payload", error);
    return null;
  }
  return data;
}

function sseUrl(projectId: ProjectId): string {
  const base = env.VITE_SERVER_URL.replace(/\/$/, "");
  return `${base}/sse/projects/${encodeURIComponent(projectId)}/events`;
}
