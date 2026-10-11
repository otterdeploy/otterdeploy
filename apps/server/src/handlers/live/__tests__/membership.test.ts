/**
 * A member removed from the organization loses the live socket.
 *
 * Each subscription on the socket passes the org-scoped guard, and an open
 * stream re-checks membership before it hands over a frame. A quiet stream
 * hands over nothing, though, so it would stay subscribed (a Redis subscriber,
 * a docker log attachment) for as long as the tab stayed open. The socket
 * itself therefore re-reads the member table on an interval and closes once
 * the user is gone, which ends every stream on it.
 *
 * These run the real upgrade on a real Bun server, with a real oRPC client on
 * the other end, and a fake member table.
 */
import type { RequestContext, ResolvedActor } from "@otterdeploy/api/context";

import { createORPCClient } from "@orpc/client";
import { StandardRPCLink } from "@orpc/client/standard";
import { LinkWebsocketClient } from "@orpc/client/websocket";
import { os, type RouterClient } from "@orpc/server";
import { createLiveSocketRpcHandler } from "@otterdeploy/api/routers/live-socket-handler";
import { idSchema } from "@otterdeploy/shared/id";
import { createRequestLogger } from "evlog";
import { Hono } from "hono";
import { websocket } from "hono/bun";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";

vi.mock("@otterdeploy/api/authz/org-member", () => ({ isOrgMember: async () => true }));

const { createLiveSocketHandler } = await import("../ws");

const RECHECK_MS = 20;
const ORG_A = idSchema.organization.parse("org_a");
const ORG_B = idSchema.organization.parse("org_b");

function sessionActor(organizationId: string | null): ResolvedActor {
  return {
    kind: "session",
    headers: new Headers(),
    user: { id: "user_1", email: "a@example.com", isInstallAdmin: false, twoFactorEnabled: false },
    session: { activeOrganizationId: organizationId },
  };
}

function contextFor(organizationId: typeof ORG_A): RequestContext {
  const session = {
    kind: "session" as const,
    headers: new Headers(),
    user: { id: "user_1", email: "a@example.com", isInstallAdmin: false, twoFactorEnabled: false },
    session: { activeOrganizationId: organizationId },
  };
  return {
    actor: session,
    session,
    apiKey: null,
    apiKeyRateLimited: null,
    activeOrganizationId: organizationId,
    headers: new Headers(),
    log: createRequestLogger({ method: "WS", path: "/live/rpc" }),
    broadcast: () => {},
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(check: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = performance.now() + timeoutMs;
  while (!check()) {
    if (performance.now() > deadline) throw new Error("timed out waiting");
    await sleep(5);
  }
}

function makeRouter(finalized: string[]) {
  return {
    events: {
      // A quiet stream: one frame, then nothing until it is let go.
      orgStream: os.$context<RequestContext>().handler(async function* ({ signal }) {
        try {
          yield "hello";
          while (!signal?.aborted) await sleep(5);
        } finally {
          finalized.push("org");
        }
      }),
    },
  };
}

interface LiveServer {
  /** Who the member table says belongs where. */
  members: Set<string>;
  /** The organization each new subscription's session is active in. */
  activeOrganization: { current: typeof ORG_A };
  finalized: string[];
  url: string;
  stop: () => void;
}

const servers: Array<{ stop: (force?: boolean) => void }> = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.stop(true);
});

function serve(options: { lookupFails?: () => boolean } = {}): LiveServer {
  const members = new Set([`user_1:${ORG_A}`, `user_1:${ORG_B}`]);
  const activeOrganization = { current: ORG_A };
  const finalized: string[] = [];

  const router = makeRouter(finalized);

  const app = new Hono();
  app.get(
    "/live/rpc",
    createLiveSocketHandler({
      trustedOrigins: [],
      resolveActor: async () => sessionActor(activeOrganization.current),
      createContext: async () => contextFor(activeOrganization.current),
      rpc: createLiveSocketRpcHandler<RequestContext>(router),
      membershipRecheckMs: RECHECK_MS,
      isMember: async (userId, organizationId) => {
        if (options.lookupFails?.()) throw new Error("connection terminated");
        return members.has(`${userId}:${organizationId}`);
      },
    }),
  );
  const server = Bun.serve({ port: 0, fetch: app.fetch, websocket });
  servers.push(server);
  return {
    members,
    activeOrganization,
    finalized,
    url: `ws://localhost:${server.port}/live/rpc`,
    stop: () => server.stop(true),
  };
}

async function connect(url: string) {
  const socket = new WebSocket(url);
  const closed = new Promise<CloseEvent>((resolve) =>
    socket.addEventListener("close", resolve, { once: true }),
  );
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener("open", () => resolve(), { once: true });
    socket.addEventListener("error", () => reject(new Error("upgrade failed")), { once: true });
  });
  const link = new StandardRPCLink(new LinkWebsocketClient({ websocket: socket }), {
    url: "http://control-plane.test/rpc",
  });
  const client: RouterClient<ReturnType<typeof makeRouter>> = createORPCClient(link);
  let isClosed = false;
  void closed.then(() => {
    isClosed = true;
  });
  return { socket, client, closed, isClosed: () => isClosed };
}

describe("the live socket and organization membership", () => {
  test("a removed member loses the socket, and every stream on it is let go", async () => {
    const h = serve();
    const live = await connect(h.url);
    const stream = await live.client.events.orgStream();
    expect(await stream.next()).toEqual({ done: false, value: "hello" });

    // Still a member: the socket stays open across several re-checks.
    await sleep(RECHECK_MS * 4);
    expect(live.isClosed()).toBe(false);

    h.members.delete(`user_1:${ORG_A}`);
    const closed = await live.closed;
    expect(closed.code).toBe(1008);
    // The quiet stream never handed over another frame, so only the socket's
    // own re-check could have ended it.
    await waitFor(() => h.finalized.includes("org"));
  });

  test("a failed member lookup is not a verdict: the socket stays open", async () => {
    let failing = false;
    const h = serve({ lookupFails: () => failing });
    const live = await connect(h.url);
    const stream = await live.client.events.orgStream();
    await stream.next();

    failing = true;
    await sleep(RECHECK_MS * 4);
    expect(live.isClosed()).toBe(false);
    expect(h.finalized).toEqual([]);
    live.socket.close();
  });

  test("after an organization switch the socket follows the organization it now serves", async () => {
    const h = serve();
    const live = await connect(h.url);
    await (await live.client.events.orgStream()).next();

    // The tab switched to B; its next subscription is served in B.
    h.activeOrganization.current = ORG_B;
    await (await live.client.events.orgStream()).next();

    // Leaving A no longer ends a socket that serves B.
    h.members.delete(`user_1:${ORG_A}`);
    await sleep(RECHECK_MS * 4);
    expect(live.isClosed()).toBe(false);

    h.members.delete(`user_1:${ORG_B}`);
    expect((await live.closed).code).toBe(1008);
  });

  test("the upgrade is refused for a session whose organization no longer has the user", async () => {
    const h = serve();
    h.members.delete(`user_1:${ORG_A}`);
    const app = new Hono();
    app.get(
      "/live/rpc",
      createLiveSocketHandler({
        trustedOrigins: [],
        resolveActor: async () => sessionActor(ORG_A),
        createContext: () => Promise.reject(new Error("no message is sent")),
        rpc: createLiveSocketRpcHandler<RequestContext>({}),
        isMember: async (userId, organizationId) => h.members.has(`${userId}:${organizationId}`),
      }),
    );
    const res = await app.request("http://deploy.example.com/live/rpc", {
      headers: { upgrade: "websocket", connection: "Upgrade", host: "deploy.example.com" },
    });
    expect(res.status).toBe(403);
  });

  test("a member lookup that fails at the upgrade is a 503, not a refusal", async () => {
    const app = new Hono();
    app.get(
      "/live/rpc",
      createLiveSocketHandler({
        trustedOrigins: [],
        resolveActor: async () => sessionActor(ORG_A),
        createContext: () => Promise.reject(new Error("no message is sent")),
        rpc: createLiveSocketRpcHandler<RequestContext>({}),
        isMember: () => Promise.reject(new Error("connection terminated")),
      }),
    );
    const res = await app.request("http://deploy.example.com/live/rpc", {
      headers: { upgrade: "websocket", connection: "Upgrade", host: "deploy.example.com" },
    });
    expect(res.status).toBe(503);
  });
});
