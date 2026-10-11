/**
 * Subscriptions on the live socket get the same organization checks as HTTP.
 *
 * Every subscription passes the org-scoped guard: membership when it starts,
 * a re-check while it runs, and the page's stated organization (the
 * `x-otterdeploy-organization` header the dashboard sets on every call). The
 * socket's context is built from the upgrade request, which carries no page
 * organization, so the header has to come from the subscription's own
 * message. Only that header: credentials stay the upgrade's.
 *
 * A real oRPC client talks to the real handler over an in-memory socket pair.
 */
import { createORPCClient, ORPCError } from "@orpc/client";
import { StandardRPCLink } from "@orpc/client/standard";
import { LinkWebsocketClient } from "@orpc/client/websocket";
import { os, type RouterClient } from "@orpc/server";
import { idSchema } from "@otterdeploy/shared/id";
import { Result } from "better-result";
import { createRequestLogger } from "evlog";
import { beforeEach, describe, expect, test, vi } from "vite-plus/test";

import type { Context } from "../context";

const isOrgMember = vi.fn(async (_userId: string, _orgId: string) => true);
vi.mock("../authz/org-member", () => ({ isOrgMember }));

const { orgScopedMiddleware } = await import("../authz/org-scope-middleware");
const { ACTING_ORGANIZATION_HEADER, ORGANIZATION_SWITCHED } =
  await import("../authz/acting-organization");
const { carryActingOrganization, createLiveSocketRpcHandler } =
  await import("./live-socket-handler");

beforeEach(() => {
  isOrgMember.mockReset();
  isOrgMember.mockResolvedValue(true);
});

const UPGRADE_COOKIE = "otterdeploy.session_token=upgrade";

/** The context the socket builds from its upgrade request. */
function upgradeContext(): Context {
  const session = {
    kind: "session" as const,
    headers: new Headers({ cookie: UPGRADE_COOKIE }),
    user: { id: "user_1", email: "a@example.com", isInstallAdmin: false, twoFactorEnabled: false },
    session: { activeOrganizationId: "org_a" },
  };
  return {
    actor: session,
    session,
    apiKey: null,
    apiKeyRateLimited: null,
    activeOrganizationId: idSchema.organization.parse("org_a"),
    headers: new Headers({ cookie: UPGRADE_COOKIE }),
    log: createRequestLogger({ method: "WS", path: "/live/rpc" }),
    broadcast: () => {},
  };
}

function makeRouter(seenCookies: Array<string | null>) {
  return {
    events: {
      orgStream: os
        .$context<Context>()
        .use(orgScopedMiddleware)
        .handler(async function* ({ context }) {
          seenCookies.push(context.headers.get("cookie"));
          for (let n = 0; n < 1_000; n++) yield n;
        }),
    },
  };
}

/** The browser end of an in-memory socket pair. */
class MemorySocket extends EventTarget {
  readyState: 0 | 1 | 2 | 3 = 1;
  constructor(private readonly deliver: (data: string | ArrayBufferView) => void) {
    super();
  }
  send(data: string | ArrayBufferLike | ArrayBufferView): void {
    if (this.readyState !== 1) return;
    this.deliver(
      typeof data === "string" || ArrayBuffer.isView(data) ? data : new Uint8Array(data),
    );
  }
}

function connect(pageHeaders: Record<string, string>) {
  const seenCookies: Array<string | null> = [];
  const router = makeRouter(seenCookies);
  const handler = createLiveSocketRpcHandler<Context>(router, {
    withRequestHeaders: carryActingOrganization,
  });
  const server = {
    send(message: string | ArrayBufferLike | Uint8Array): number {
      socket.dispatchEvent(new MessageEvent("message", { data: message }));
      return 1;
    },
  };
  const socket = new MemorySocket((data) => {
    void handler.message(server, data, { context: upgradeContext() });
  });
  const link = new StandardRPCLink(new LinkWebsocketClient({ websocket: socket }), {
    url: "http://control-plane.test/rpc",
    headers: () => pageHeaders,
  });
  const client: RouterClient<ReturnType<typeof makeRouter>> = createORPCClient(link);
  return {
    client,
    seenCookies,
    close: () => {
      socket.readyState = 3;
      handler.close(server);
    },
  };
}

async function refusal(promise: Promise<unknown>): Promise<unknown> {
  const result = await Result.tryPromise({ try: () => promise, catch: (error) => error });
  expect(result.isErr()).toBe(true);
  return result.isErr() ? result.error : undefined;
}

describe("organization checks on the live socket", () => {
  test("a subscription from a page of another organization is refused, as over HTTP", async () => {
    const live = connect({ [ACTING_ORGANIZATION_HEADER]: "org_b" });
    const error = await refusal(live.client.events.orgStream());
    expect(error).toBeInstanceOf(ORPCError);
    expect(error).toMatchObject({ code: ORGANIZATION_SWITCHED, status: 409 });
    live.close();
  });

  test("a subscription from a page of the session's organization is served", async () => {
    const live = connect({ [ACTING_ORGANIZATION_HEADER]: "org_a" });
    const stream = await live.client.events.orgStream();
    expect(await stream.next()).toEqual({ done: false, value: 0 });
    live.close();
  });

  test("a message cannot bring its own credentials: the upgrade's stay", async () => {
    const live = connect({
      [ACTING_ORGANIZATION_HEADER]: "org_a",
      cookie: "otterdeploy.session_token=someone-else",
    });
    const stream = await live.client.events.orgStream();
    await stream.next();
    expect(live.seenCookies).toEqual([UPGRADE_COOKIE]);
    live.close();
  });

  test("a subscription from a user no longer in the organization is refused", async () => {
    isOrgMember.mockResolvedValue(false);
    const live = connect({ [ACTING_ORGANIZATION_HEADER]: "org_a" });
    const error = await refusal(live.client.events.orgStream());
    expect(error).toMatchObject({ code: "FORBIDDEN", status: 403 });
    live.close();
  });

  test("an open subscription is cut off once the user is removed", async () => {
    let clock = 0;
    const now = vi.spyOn(performance, "now").mockImplementation(() => clock);
    try {
      const live = connect({ [ACTING_ORGANIZATION_HEADER]: "org_a" });
      const stream = await live.client.events.orgStream();
      expect(await stream.next()).toEqual({ done: false, value: 0 });

      isOrgMember.mockResolvedValue(false);
      clock = 60_000;
      // Frames already in flight may still arrive; the stream then ends.
      const ended = await Result.tryPromise({
        try: async () => {
          for (;;) {
            const next = await stream.next();
            if (next.done) return "done";
          }
        },
        catch: (error) => error,
      });
      expect(ended.isErr() ? ended.error : ended.value).toMatchObject({
        code: "FORBIDDEN",
        status: 403,
      });
      live.close();
    } finally {
      now.mockRestore();
    }
  });
});
