/**
 * SSE handler: stream project events to the browser.
 *
 * Bridges the in-process docker event bus (via `streamProjectEvents`,
 * which already does org-scoped filtering) into a native EventSource
 * connection. Each push lands as `event: <kind>` / `data: <JSON>` so
 * the client can route via `addEventListener("resource", …)` instead
 * of pattern-matching JSON.
 *
 * Auth + active-org come from the `requireSseSession` middleware in
 * lib/sse-auth.ts; the `projectId` brand comes from the
 * `validateParams` middleware. The route file just wires them in
 * order — this file stays focused on the streaming protocol.
 */

import type { Handler } from "hono";
import { streamSSE } from "hono/streaming";

import { streamProjectEvents } from "@otterdeploy/api/routers/project/events-stream";
import type { OrganizationId, ProjectId } from "@otterdeploy/shared/id";

import type { SseAuthVariables } from "../lib/sse-auth";
import type { ValidatedVariables } from "../lib/validate";

type Vars = SseAuthVariables & ValidatedVariables<{ projectId: ProjectId }>;

export const projectEventsSseHandler: Handler<{ Variables: Vars }> = (c) => {
  const { projectId } = c.var.params;
  const organizationId = c.var.organizationId as OrganizationId;

  return streamSSE(
    c,
    async (stream) => {
      const generator = streamProjectEvents({ projectId, organizationId });

      // Heartbeat every 25s so intermediate proxies don't kill an
      // idle connection. The browser ignores comment lines.
      const heartbeat = setInterval(() => {
        void stream.writeSSE({ data: "", event: "ping" }).catch(() => {});
      }, 25_000);

      try {
        for await (const event of generator) {
          await stream.writeSSE({
            event: event.kind,
            id: String(Date.now()),
            data: JSON.stringify(event),
          });
        }
      } finally {
        clearInterval(heartbeat);
        // Tell the generator to release its docker-bus subscription.
        await generator.return?.(undefined);
      }
    },
    async (err, stream) => {
      await stream
        .writeSSE({
          event: "error",
          data: JSON.stringify({
            message: err instanceof Error ? err.message : String(err),
          }),
        })
        .catch(() => {});
    },
  );
};
