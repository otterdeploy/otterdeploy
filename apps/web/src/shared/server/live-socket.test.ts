/**
 * A dashboard tab holds at most ONE long-lived connection, and a
 * hidden tab lets go of it.
 *
 * The client is the dashboard's own link (./link.ts, what orpc.ts builds),
 * talking to the real live-socket handler over an in-memory socket pair and to
 * the real oRPC fetch handler over an in-memory `fetch`. The fetch side counts
 * requests whose response body is still open: a long-lived HTTP connection is
 * exactly that, and it is what the browser's six-per-host pool runs out of.
 */
import { createORPCClient, type ClientContext } from "@orpc/client";
import { type ClientRetryPluginContext } from "@orpc/client/plugins";
import { os, type RouterClient } from "@orpc/server";
import { RPCHandler as FetchRPCHandler } from "@orpc/server/fetch";
import { createLiveSocketRpcHandler } from "@otterdeploy/api/routers/live-socket-handler";
import { Result } from "better-result";
import { describe, expect, test } from "vite-plus/test";
import * as z from "zod";

import { createAppLink } from "./link";
import { type VisibilitySource } from "./live-socket";

interface ServerContext {
  /** Whether the socket's (or request's) session is still signed in. */
  signedIn: boolean;
}

const base = os.$context<ServerContext>();

function makeRouter(finalized: string[]) {
  async function* ticks(name: string, signal: AbortSignal | undefined) {
    try {
      for (let n = 0; !signal?.aborted; n++) {
        yield `${name}:${n}`;
        await new Promise((resolve) => setTimeout(resolve, 2));
      }
    } finally {
      finalized.push(name);
    }
  }
  const authed = base.middleware(({ context, next }) => {
    if (!context.signedIn) throw new Error("signed out");
    return next();
  });
  // Paths mirror the real router's, which is what the live-socket list names.
  return {
    events: {
      orgStream: base.errors({ UNAUTHORIZED: {} }).handler(({ context, errors, signal }) => {
        if (!context.signedIn) throw errors.UNAUTHORIZED();
        return ticks("org", signal);
      }),
      stream: base
        .use(authed)
        .input(z.object({ projectId: z.string() }))
        .handler(({ input, signal }) => ticks(`project:${input.projectId}`, signal)),
    },
    project: {
      logs: { tail: base.use(authed).handler(({ signal }) => ticks("log-tail", signal)) },
      resource: {
        database: {
          postgres: {
            // A request-bound stream: stays on HTTP by design.
            create: base.handler(({ signal }) => ticks("pg-create", signal)),
          },
        },
      },
    },
    organization: { settings: base.handler(() => ({ name: "acme" })) },
  };
}

/** The browser end of an in-memory socket pair. */
class MemorySocket extends EventTarget {
  readyState: 0 | 1 | 2 | 3 = 0;
  onSend: (data: string | ArrayBufferLike | ArrayBufferView | Blob) => void = () => {};
  onClose: () => void = () => {};
  send(data: string | ArrayBufferLike | ArrayBufferView | Blob): void {
    if (this.readyState === 1) this.onSend(data);
  }
  close(): void {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.onClose();
    this.dispatchEvent(new Event("close"));
  }
}

function fakeVisibility() {
  let hidden = false;
  const listeners = new Set<() => void>();
  const source: VisibilitySource = {
    hidden: () => hidden,
    subscribe(onChange) {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
  };
  return {
    source,
    set(next: boolean) {
      hidden = next;
      for (const listener of listeners) listener();
    },
  };
}

function setup(
  options: {
    /** Refuse the upgrade of the n-th socket (0-based). */
    refuseUpgrade?: (index: number) => boolean;
    neverOpens?: boolean;
    releaseAfterMs?: number;
  } = {},
) {
  const finalized: string[] = [];
  const router = makeRouter(finalized);
  const socketHandler = createLiveSocketRpcHandler<ServerContext>(router);
  const fetchHandler = new FetchRPCHandler<ServerContext>(router);
  const visibility = fakeVisibility();
  const session = { signedIn: true };

  const sockets: MemorySocket[] = [];
  let openHttp = 0;
  const httpPaths: string[] = [];

  const createSocket = () => {
    const socket = new MemorySocket();
    const index = sockets.length;
    sockets.push(socket);
    // Each socket keeps the session it was opened with, as a real upgrade
    // keeps the cookies it carried.
    const context: ServerContext = { signedIn: session.signedIn };
    const server = {
      send(message: string | ArrayBufferLike | Uint8Array): number {
        if (socket.readyState === 1)
          socket.dispatchEvent(new MessageEvent("message", { data: message }));
        return 1;
      },
    };
    socket.onSend = (data) => {
      if (typeof data === "string" || ArrayBuffer.isView(data)) {
        void socketHandler.message(server, data, { context });
      }
    };
    socket.onClose = () => socketHandler.close(server);
    queueMicrotask(() => {
      if (options.neverOpens) return;
      if (options.refuseUpgrade?.(index)) {
        socket.readyState = 3;
        socket.dispatchEvent(new Event("error"));
        socket.dispatchEvent(new Event("close"));
        return;
      }
      socket.readyState = 1;
      socket.dispatchEvent(new Event("open"));
    });
    return socket;
  };

  const fetch = async (request: Request): Promise<Response> => {
    httpPaths.push(new URL(request.url).pathname);
    const { response } = await fetchHandler.handle(request, {
      prefix: "/rpc",
      context: { signedIn: session.signedIn },
    });
    if (!response?.body) return response ?? new Response(null, { status: 404 });
    // Count the request as open until its body is done: that is the span a
    // browser holds the connection for.
    openHttp++;
    let closed = false;
    const done = () => {
      if (closed) return;
      closed = true;
      openHttp--;
    };
    const body = response.body.pipeThrough(
      new TransformStream({
        flush: done,
      }),
    );
    request.signal.addEventListener("abort", done, { once: true });
    return new Response(body, response);
  };

  const { link, liveSocket } = createAppLink<ClientRetryPluginContext & ClientContext>({
    serverUrl: "http://203.0.113.7:3000",
    fetch,
    createSocket,
    visibility: visibility.source,
    releaseAfterMs: options.releaseAfterMs ?? 30,
    retrySocketAfterMs: 60_000,
    openTimeoutMs: 20,
  });
  const client: RouterClient<typeof router, ClientRetryPluginContext> = createORPCClient(link);

  return {
    client,
    liveSocket,
    visibility,
    session,
    finalized,
    httpPaths,
    openSockets: () => sockets.filter((socket) => socket.readyState !== 3).length,
    /** What a server restart does to the tab's open socket. */
    dropSockets: () => {
      for (const socket of sockets) socket.close();
    },
    socketsCreated: () => sockets.length,
    openHttp: () => openHttp,
  };
}

async function next<T>(iterator: AsyncIterator<T>): Promise<T> {
  const result = await iterator.next();
  if (result.done) throw new Error("stream ended");
  return result.value;
}

/** What useOrgEvents / useProjectEvents pass: reconnect forever, no delay in a test. */
function liveContext(onReconnected: () => void = () => {}) {
  return {
    retry: Number.POSITIVE_INFINITY,
    retryDelay: 0,
    onRetry: () => (reconnected: boolean) => {
      if (reconnected) onReconnected();
    },
  };
}

describe("dashboard connection budget", () => {
  test("the graph plus a log tail hold one long-lived connection, and a click still answers", async () => {
    const h = setup();
    const controller = new AbortController();
    const signal = controller.signal;

    // What a project's graph tab with Overview's log tail open subscribes to.
    const org = await h.client.events.orgStream(undefined, { signal, context: liveContext() });
    const project = await h.client.events.stream(
      { projectId: "prj_a" },
      { signal, context: liveContext() },
    );
    const tail = await h.client.project.logs.tail(undefined, { signal });

    expect(await next(org)).toBe("org:0");
    expect(await next(project)).toBe("project:prj_a:0");
    expect(await next(tail)).toBe("log-tail:0");

    expect(h.openHttp()).toBe(0);
    expect(h.openSockets()).toBe(1);
    expect(h.openHttp() + h.openSockets()).toBeLessThanOrEqual(1);

    // Ordinary calls are plain HTTP and are not queued behind the streams.
    expect(await h.client.organization.settings()).toEqual({ name: "acme" });
    expect(h.httpPaths).toEqual(["/rpc/organization/settings"]);
    expect(h.openHttp()).toBe(0);

    controller.abort();
  });

  test("a hidden tab releases its socket, parks new streams, and resumes with a resync when shown", async () => {
    const h = setup({ releaseAfterMs: 20 });
    const controller = new AbortController();
    const signal = controller.signal;
    let resyncs = 0;

    const org = await h.client.events.orgStream(undefined, {
      signal,
      context: liveContext(() => resyncs++),
    });
    const tail = await h.client.project.logs.tail(undefined, { signal });
    await next(org);
    await next(tail);

    h.visibility.set(true);
    await expect.poll(() => h.liveSocket.released).toBe(true);

    // Released: no socket, every stream on it ended server-side, and nothing
    // fell back to holding an HTTP request instead.
    expect(h.openSockets()).toBe(0);
    await expect.poll(() => h.finalized.toSorted()).toEqual(["log-tail", "org"]);
    expect(h.openHttp()).toBe(0);

    // The org stream's reconnect is parked while hidden, not spinning.
    const parked = next(org);
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(h.socketsCreated()).toBe(1);
    expect(resyncs).toBe(0);

    h.visibility.set(false);
    expect(await parked).toMatch(/^org:/);
    expect(h.socketsCreated()).toBe(2);
    expect(h.openSockets()).toBe(1);
    expect(h.openHttp()).toBe(0);
    // The reconnect resynced what the gap may have missed.
    expect(resyncs).toBe(1);

    controller.abort();
  });

  test("a tab shown again before the grace period keeps its socket", async () => {
    const h = setup({ releaseAfterMs: 50 });
    const controller = new AbortController();
    const org = await h.client.events.orgStream(undefined, {
      signal: controller.signal,
      context: liveContext(),
    });
    await next(org);

    h.visibility.set(true);
    h.visibility.set(false);
    await new Promise((resolve) => setTimeout(resolve, 80));

    expect(h.liveSocket.released).toBe(false);
    expect(h.socketsCreated()).toBe(1);
    expect(await next(org)).toMatch(/^org:/);
    controller.abort();
  });

  test("when a proxy refuses the upgrade, streams still work over HTTP", async () => {
    const h = setup({ refuseUpgrade: () => true });
    const controller = new AbortController();
    const org = await h.client.events.orgStream(undefined, {
      signal: controller.signal,
      context: liveContext(),
    });
    expect(await next(org)).toBe("org:0");
    expect(h.httpPaths).toEqual(["/rpc/events/orgStream"]);
    controller.abort();
  });

  test("a socket that neither opens nor fails is given up on, and the stream uses HTTP", async () => {
    const h = setup({ neverOpens: true });
    const controller = new AbortController();
    const org = await h.client.events.orgStream(undefined, {
      signal: controller.signal,
      context: liveContext(),
    });
    expect(await next(org)).toBe("org:0");
    expect(h.httpPaths).toEqual(["/rpc/events/orgStream"]);
    controller.abort();
  });

  test("a control plane restart reconnects on a socket, not by moving the stream to HTTP", async () => {
    // The second socket is refused: the server is still coming back up.
    const h = setup({ refuseUpgrade: (index) => index === 1 });
    const controller = new AbortController();
    let resyncs = 0;
    const org = await h.client.events.orgStream(undefined, {
      signal: controller.signal,
      context: liveContext(() => resyncs++),
    });
    await next(org);

    // The restart drops the socket under the stream.
    h.dropSockets();
    expect(await next(org)).toMatch(/^org:/);

    expect(h.httpPaths).toEqual([]);
    expect(h.socketsCreated()).toBe(3);
    expect(h.openSockets()).toBe(1);
    expect(resyncs).toBe(1);
    controller.abort();
  });

  test("a request-bound stream stays on HTTP", async () => {
    const h = setup();
    const controller = new AbortController();
    const create = await h.client.project.resource.database.postgres.create(undefined, {
      signal: controller.signal,
    });
    expect(await next(create)).toBe("pg-create:0");
    expect(h.socketsCreated()).toBe(0);
    controller.abort();
  });

  test("a socket whose session ended is replaced once, with the cookies the tab has now", async () => {
    const h = setup();
    const controller = new AbortController();
    const signal = controller.signal;

    // A socket opened while signed out (the sign-in page's tab, say).
    h.session.signedIn = false;
    const first = await Result.tryPromise({
      try: () => h.client.events.orgStream(undefined, { signal }),
      catch: (error) => error,
    });
    expect(first.isErr()).toBe(true);

    // Signed in since: the next subscription gets a fresh socket and works.
    h.session.signedIn = true;
    const org = await h.client.events.orgStream(undefined, { signal });
    expect(await next(org)).toBe("org:0");
    expect(h.socketsCreated()).toBeGreaterThanOrEqual(2);
    expect(h.openSockets()).toBe(1);
    controller.abort();
  });
});
