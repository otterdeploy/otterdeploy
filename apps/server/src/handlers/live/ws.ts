/**
 * `/live/rpc`: the dashboard's live socket.
 *
 * One WebSocket per tab carries every long-lived stream that tab subscribes to
 * (event streams, log tails); see packages/api/src/routers/live-socket.ts for
 * why, and live-socket-handler.ts for the oRPC side. This file is the upgrade.
 *
 * Unlike /pty, the socket authenticates with the session cookie, because what
 * runs over it is exactly what the same cookie already reads over HTTP. That
 * is the cross-site WebSocket hijacking shape (a browser attaches ambient
 * cookies to a cross-origin upgrade and enforces no same-origin policy on
 * it), so the Origin check below is the CSRF defence here, not defence in
 * depth: a page on another origin is refused before the upgrade. An absent
 * Origin is not a browser and so not that threat; it still needs a session.
 *
 * Each message is authorized on its own: the session is resolved again for
 * every subscription, from Postgres rather than the session-cache cookie
 * captured with the upgrade (that cookie never refreshes on a socket, so an
 * org switch or a sign-out would otherwise go unseen for minutes). A socket
 * whose session ended is answered UNAUTHORIZED on its next subscription, and
 * the client then reconnects with the cookies it has now.
 */
import type { Context as RequestContext, ResolvedActor } from "@otterdeploy/api/context";
import type { LiveSocketRpcHandler } from "@otterdeploy/api/routers/live-socket-handler";
import type { ServerWebSocket } from "bun";
import type { EvlogVariables } from "evlog/hono";
import type { Context as HonoContext, MiddlewareHandler } from "hono";
import type { WSEvents, WSMessageReceive } from "hono/ws";

import { REQUEST_QUERY_TIMEOUT_MS, runWithQueryDeadline } from "@otterdeploy/db/query-deadline";
import { Result } from "better-result";
import { log } from "evlog";
import { upgradeWebSocket } from "hono/bun";

import { isTrustedOrigin } from "../terminal/origin";

/** What the upgrade needs from the rest of the server, injectable for tests. */
export interface LiveSocketDeps {
  /** The actor the upgrade request's own credentials resolve to, or null. */
  resolveActor(headers: Headers): Promise<ResolvedActor>;
  /** Build one subscription's request context from the upgrade request. */
  createContext(c: HonoContext<EvlogVariables>): Promise<RequestContext>;
  trustedOrigins: readonly string[];
  /** The oRPC side: serves the live-socket procedures over the socket. */
  rpc: LiveSocketRpcHandler<RequestContext>;
}

/** A frame as the oRPC adapter takes it. Bun delivers text or binary; hono
 *  hands binary over as an ArrayBuffer. */
function toFrame(data: WSMessageReceive): string | Uint8Array | null {
  if (typeof data === "string") return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return null;
}

// The events are typed over Bun's ServerWebSocket: that is what hono/bun hands
// back as `ws.raw`, and what the oRPC Bun adapter keys its peers by.
function liveSocketEvents(
  c: HonoContext<EvlogVariables>,
  deps: LiveSocketDeps,
): WSEvents<ServerWebSocket<unknown>> {
  return {
    onMessage(event, ws) {
      const socket = ws.raw;
      const frame = toFrame(event.data);
      if (!socket || frame === null) return;
      void Result.tryPromise({
        try: () =>
          runWithQueryDeadline(REQUEST_QUERY_TIMEOUT_MS, async () => {
            await deps.rpc.message(socket, frame, { context: await deps.createContext(c) });
          }),
        catch: (cause) => cause,
      }).then((handled) => {
        if (handled.isErr()) {
          log.error({ live: { event: "message-failed" }, error: String(handled.error) });
        }
      });
    },
    onClose(_event, ws) {
      if (ws.raw) deps.rpc.close(ws.raw);
    },
  };
}

export function createLiveSocketHandler(deps: LiveSocketDeps): MiddlewareHandler<EvlogVariables> {
  return async (c, next) => {
    if (c.req.header("upgrade")?.toLowerCase() !== "websocket") return next();

    const origin = c.req.header("origin");
    if (!isTrustedOrigin(origin, deps.trustedOrigins, c.req.header("host"))) {
      log.warn({ live: { event: "origin-rejected", origin: origin ?? "(missing)" } });
      return c.json({ message: "Origin not allowed" }, 403);
    }

    // Refuse a socket nobody could use. The client falls back to HTTP for the
    // call that tried it, and that call's UNAUTHORIZED is what sends the
    // dashboard to sign-in.
    const actor = await Result.tryPromise({
      try: () => deps.resolveActor(c.req.raw.headers),
      catch: (cause) => cause,
    });
    if (actor.isErr()) {
      // The session store did not answer. Not a verdict on the caller: the
      // client uses plain HTTP meanwhile and tries the socket again later.
      log.warn({ live: { event: "session-lookup-failed" }, error: String(actor.error) });
      return c.json({ message: "Live updates are unavailable right now" }, 503);
    }
    if (!actor.value) return c.json({ message: "Unauthorized" }, 401);

    return upgradeWebSocket(c, liveSocketEvents(c, deps));
  };
}
