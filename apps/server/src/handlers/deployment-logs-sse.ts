/**
 * SSE handler: stream a deployment's build/run log lines.
 *
 * Same pattern as project-events-sse.ts — middleware chain handles
 * auth + param validation; this file is the streaming protocol only.
 * Each line ships as its own SSE event so the client can route by
 * stream type (`stdout` / `stderr` / `system`); `id:` carries the DB
 * sequence (or a `live-<ts>` placeholder when the line hasn't landed
 * in the DB yet) so EventSource's `Last-Event-ID` reconnect works.
 */

import type { Handler } from "hono";
import { streamSSE } from "hono/streaming";

import { streamDeploymentLogs } from "@otterdeploy/api/routers/deployment/log-stream";
import type { DeploymentId, OrganizationId } from "@otterdeploy/shared/id";

import type { SseAuthVariables } from "../lib/sse-auth";
import type { ValidatedVariables } from "../lib/validate";

type Vars = SseAuthVariables & ValidatedVariables<{ deploymentId: DeploymentId }>;

export const deploymentLogsSseHandler: Handler<{ Variables: Vars }> = (c) => {
  const { deploymentId } = c.var.params;
  const organizationId = c.var.organizationId as OrganizationId;

  return streamSSE(
    c,
    async (stream) => {
      const generator = streamDeploymentLogs({ deploymentId, organizationId });

      const heartbeat = setInterval(() => {
        void stream.writeSSE({ data: "", event: "ping" }).catch(() => {});
      }, 25_000);

      try {
        for await (const line of generator) {
          await stream.writeSSE({
            event: line.stream,
            id: line.seq != null ? String(line.seq) : `live-${line.ts}`,
            data: JSON.stringify(line),
          });
        }
        // Generator returned cleanly — deployment is terminal, no more lines.
        await stream.writeSSE({ event: "end", data: "{}" }).catch(() => {});
      } finally {
        clearInterval(heartbeat);
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
