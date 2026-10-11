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
 * the client then reconnects with the cookies it has now. Every subscription
 * then passes the org-scoped guard like the same call over HTTP: membership
 * when it starts, and a re-check before each frame while it runs.
 *
 * Membership is also held at the socket. The upgrade is refused for a session
 * whose organization no longer has the user, and an open socket re-reads the
 * member table on an interval and closes (1008) once the user has left the
 * organization it serves. The per-frame re-check cannot do that on its own: a
 * quiet stream hands over no frame, so it stayed subscribed for as long as the
 * tab stayed open. Closing the socket ends every stream on it.
 */
import type { Context as RequestContext, ResolvedActor } from "@otterdeploy/api/context";
import type { LiveSocketRpcHandler } from "@otterdeploy/api/routers/live-socket-handler";
import type { ServerWebSocket } from "bun";
import type { EvlogVariables } from "evlog/hono";
import type { Context as HonoContext, MiddlewareHandler } from "hono";
import type { WSContext, WSEvents, WSMessageReceive } from "hono/ws";

import { isOrgMember } from "@otterdeploy/api/authz/org-member";
import { STREAM_MEMBERSHIP_RECHECK_MS } from "@otterdeploy/api/authz/stream-membership";
import { REQUEST_QUERY_TIMEOUT_MS, runWithQueryDeadline } from "@otterdeploy/db/query-deadline";
import { ID_PREFIX, zId } from "@otterdeploy/shared/id";
import { Result } from "better-result";
import { log } from "evlog";
import { upgradeWebSocket } from "hono/bun";

import { watchMembership } from "../../lib/membership-watch";
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
  /** Seams for tests: the member table and how often an open socket re-reads
   *  it. Production uses the member table and the stream re-check period. */
  isMember?: (userId: string, organizationId: string) => Promise<boolean>;
  membershipRecheckMs?: number;
}

/** Close code for a socket whose user left its organization (RFC 6455 policy
 *  violation). The client sends its next calls over HTTP on seeing it. */
const MEMBERSHIP_REVOKED_CLOSE = 1008;

/** Who a socket acts for, and in which organization. */
interface MembershipScope {
  userId: string;
  organizationId: string;
}

const organizationIdSchema = zId(ID_PREFIX.organization);

/** A session actor's user and active organization (canonical, as a
 *  subscription's context carries it); null for an API key (its organization
 *  is the key's own) or a session with no organization yet. */
function sessionScope(actor: ResolvedActor): MembershipScope | null {
  if (actor?.kind !== "session") return null;
  const organizationId = organizationIdSchema.safeParse(actor.session.activeOrganizationId);
  if (!organizationId.success) return null;
  return { userId: actor.user.id, organizationId: organizationId.data };
}

/** A frame as the oRPC adapter takes it. Bun delivers text or binary; hono
 *  hands binary over as an ArrayBuffer. */
function toFrame(data: WSMessageReceive): string | Uint8Array | null {
  if (typeof data === "string") return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return null;
}

/**
 * The socket's membership watch. It follows the organization the socket
 * serves: the upgrade's, then whichever organization the latest subscription
 * was served in (the session's active organization is shared by every tab, and
 * a switch moves the tab's next subscriptions with it).
 */
function socketMembership(deps: LiveSocketDeps, initial: MembershipScope | null) {
  let scope = initial;
  let socket: WSContext<ServerWebSocket<unknown>> | null = null;
  let stop: (() => void) | null = null;

  const watch = () => {
    stop?.();
    stop = null;
    if (!scope || !socket) return;
    const watched = scope;
    const ws = socket;
    stop = watchMembership({
      ...watched,
      intervalMs: deps.membershipRecheckMs ?? STREAM_MEMBERSHIP_RECHECK_MS,
      isMember: deps.isMember,
      logAs: "live",
      onRevoked: () => ws.close(MEMBERSHIP_REVOKED_CLOSE, "Not a member of this organization"),
    });
  };

  return {
    opened(ws: WSContext<ServerWebSocket<unknown>>) {
      socket = ws;
      watch();
    },
    /** A subscription was served in this context's organization. */
    served(context: RequestContext) {
      if (!context.session || !context.activeOrganizationId) return;
      const next = {
        userId: context.session.user.id,
        organizationId: context.activeOrganizationId,
      };
      if (scope?.userId === next.userId && scope.organizationId === next.organizationId) return;
      scope = next;
      watch();
    },
    closed() {
      stop?.();
      stop = null;
      socket = null;
    },
  };
}

// The events are typed over Bun's ServerWebSocket: that is what hono/bun hands
// back as `ws.raw`, and what the oRPC Bun adapter keys its peers by.
function liveSocketEvents(
  c: HonoContext<EvlogVariables>,
  deps: LiveSocketDeps,
  scope: MembershipScope | null,
): WSEvents<ServerWebSocket<unknown>> {
  const membership = socketMembership(deps, scope);
  return {
    onOpen(_event, ws) {
      membership.opened(ws);
    },
    onMessage(event, ws) {
      const socket = ws.raw;
      const frame = toFrame(event.data);
      if (!socket || frame === null) return;
      void Result.tryPromise({
        try: () =>
          runWithQueryDeadline(REQUEST_QUERY_TIMEOUT_MS, async () => {
            const context = await deps.createContext(c);
            membership.served(context);
            await deps.rpc.message(socket, frame, { context });
          }),
        catch: (cause) => cause,
      }).then((handled) => {
        if (handled.isErr()) {
          log.error({ live: { event: "message-failed" }, error: String(handled.error) });
        }
      });
    },
    onClose(_event, ws) {
      membership.closed();
      if (ws.raw) deps.rpc.close(ws.raw);
    },
  };
}

export function createLiveSocketHandler(deps: LiveSocketDeps): MiddlewareHandler<EvlogVariables> {
  const isMember = deps.isMember ?? isOrgMember;
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

    // A session still naming an organization the user has left would get
    // FORBIDDEN on every subscription: refuse the socket instead, so the
    // client's calls go over HTTP and are answered there.
    const scope = sessionScope(actor.value);
    if (scope) {
      const member = await Result.tryPromise({
        try: () => isMember(scope.userId, scope.organizationId),
        catch: (cause) => cause,
      });
      if (member.isErr()) {
        log.warn({ live: { event: "membership-lookup-failed" }, error: String(member.error) });
        return c.json({ message: "Live updates are unavailable right now" }, 503);
      }
      if (!member.value) {
        log.info({ live: { event: "membership-rejected", organizationId: scope.organizationId } });
        return c.json({ message: "You are not a member of this organization." }, 403);
      }
    }

    return upgradeWebSocket(c, liveSocketEvents(c, deps, scope));
  };
}
