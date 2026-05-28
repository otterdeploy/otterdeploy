/**
 * SSE endpoint that streams deployment build/run logs to the browser.
 *
 * Same shape as `events-sse.ts`: native EventSource → cookie auth via
 * better-auth → bridge to an api-side async generator
 * (`streamDeploymentLogs`). The api side enforces org ownership; this
 * handler just relays the active organization.
 *
 * Each line is sent as its own SSE event so the client can route by
 * stream type (`stdout` / `stderr` / `system`) via
 * `addEventListener(…)`. `id:` carries the DB sequence (or the live
 * timestamp when the line hasn't landed in the DB yet) to support
 * EventSource's `Last-Event-ID` reconnect.
 */

import type { Hono as HonoApp } from "hono";
import { streamSSE } from "hono/streaming";

import { type EvlogVariables } from "evlog/hono";

import { streamDeploymentLogs } from "@otterdeploy/api/routers/deployment/log-stream";
import { auth, type Session } from "@otterdeploy/auth";

type DeploymentId = string;
type OrgId = string;

export function registerDeploymentLogsSseRoutes(app: HonoApp<EvlogVariables>): void {
  app.get("/sse/deployments/:deploymentId/logs", async (c) => {
    const deploymentId: DeploymentId = c.req.param("deploymentId");

    const session = (await auth.api.getSession({
      headers: c.req.raw.headers,
    })) as Session | null;
    if (!session?.user) {
      return c.text("Unauthorized", 401);
    }
    const organizationId: OrgId | null =
      session.session.activeOrganizationId ?? null;
    if (!organizationId) {
      return c.text("No active organization", 400);
    }

    return streamSSE(
      c,
      async (stream) => {
        const generator = streamDeploymentLogs({
          deploymentId: deploymentId as never,
          organizationId: organizationId as never,
        });

        // Heartbeat every 25s — same reason as events-sse.ts.
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
          await stream
            .writeSSE({ event: "end", data: "{}" })
            .catch(() => {});
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
  });
}
