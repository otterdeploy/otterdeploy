/**
 * SSE endpoint that pushes project events to the browser.
 *
 * Native `EventSource` is the natural client here — it ships with the
 * platform, handles reconnect with `Last-Event-ID`, and lets the
 * frontend hook stay tiny (one useEffect, no for-await loop, no
 * abort-controller plumbing). We bridge to the existing in-process
 * docker event bus via `streamProjectEvents`, which already does the
 * org-scoped filtering.
 *
 * Auth: cookies. `EventSource` doesn't accept custom headers, but it
 * sends cookies by default — so `better-auth.getSession` works the
 * same as it does for the oRPC handler.
 *
 * Response semantics:
 *   - `event: <kind>` on every message so the client can route via
 *     `addEventListener("resource", …)` instead of pattern-matching JSON
 *   - `data: <JSON payload>` carries the slim event shape the bus emits
 *   - `id: <timestamp>` lets the browser resume after a network blip
 *   - no `retry:` — we leave reconnect intervals to the browser default
 */
import type { ProjectId } from "@otterdeploy/shared/id";

import type { Hono as HonoApp } from "hono";
import { streamSSE } from "hono/streaming";

import { type EvlogVariables } from "evlog/hono";

import { streamProjectEvents } from "@otterdeploy/api/routers/project/events-stream";
import { auth, type Session } from "@otterdeploy/auth";

type OrgId = string;

export function registerEventsSseRoutes(app: HonoApp<EvlogVariables>): void {
  app.get("/sse/projects/:projectId/events", async (c) => {
    const projectId = c.req.param("projectId") as ProjectId;

    // Cookie-auth via better-auth. EventSource can't set headers so the
    // session has to ride in on cookies — which is the browser default
    // for same-origin requests anyway.
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

    // streamProjectEvents itself verifies the project belongs to the
    // org (returns an empty stream otherwise), so we don't double-check
    // here — keep this handler thin. The `as never` casts launder the
    // branded ids from `string` here into the api-side branded types;
    // the runtime values are identical strings.
    return streamSSE(
      c,
      async (stream) => {
        const generator = streamProjectEvents({
          projectId: projectId as never,
          organizationId: organizationId as never,
        });

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
      // onError: hand a final line to the client before the stream
      // closes so it can log + reconnect.
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
