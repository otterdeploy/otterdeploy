/**
 * The live socket multiplexes subscriptions and serves nothing
 * else.
 *
 * A real oRPC client (the WebSocket link the dashboard uses) talks to the real
 * handler over an in-memory socket pair, so what is under test is the wire
 * protocol end to end, minus the TCP.
 */
import { createORPCClient, ORPCError } from "@orpc/client";
import { StandardRPCLink } from "@orpc/client/standard";
import { LinkWebsocketClient } from "@orpc/client/websocket";
import { os, type RouterClient } from "@orpc/server";
import { Result } from "better-result";
import { describe, expect, test } from "vite-plus/test";
import * as z from "zod";

import { createLiveSocketRpcHandler } from "./live-socket-handler";

/** A router whose streams record when they are finalized: proof a stream let go. */
function makeRouter(finalized: string[]) {
  async function* ticks(name: string, signal: AbortSignal | undefined) {
    try {
      for (let n = 0; !signal?.aborted; n++) {
        yield `${name}:${n}`;
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
    } finally {
      finalized.push(name);
    }
  }

  return {
    events: {
      orgStream: os.handler(({ signal }) => ticks("org", signal)),
      stream: os
        .input(z.object({ projectId: z.string() }))
        .handler(({ input, signal }) => ticks(`project-${input.projectId}`, signal)),
    },
    project: {
      logs: { tail: os.handler(({ signal }) => ticks("tail", signal)) },
      update: os.handler(() => "updated"),
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

function connect() {
  const finalized: string[] = [];
  const router = makeRouter(finalized);
  const handler = createLiveSocketRpcHandler(router);
  const server = {
    send(message: string | ArrayBufferLike | Uint8Array): number {
      socket.dispatchEvent(new MessageEvent("message", { data: message }));
      return 1;
    },
  };
  const socket = new MemorySocket((data) => {
    void handler.message(server, data, { context: {} });
  });
  // Built the way the dashboard builds it: the request is the one plain HTTP
  // would send (so it carries the `/rpc` prefix), only the transport differs.
  const link = new StandardRPCLink(new LinkWebsocketClient({ websocket: socket }), {
    url: "http://control-plane.test/rpc",
  });
  const client: RouterClient<typeof router> = createORPCClient(link);
  return {
    client,
    finalized,
    close: () => {
      socket.readyState = 3;
      handler.close(server);
      socket.dispatchEvent(new Event("close"));
    },
  };
}

async function take<T>(iterator: AsyncIterator<T>, count: number): Promise<T[]> {
  const out: T[] = [];
  while (out.length < count) {
    const next = await iterator.next();
    if (next.done) break;
    out.push(next.value);
  }
  return out;
}

describe("live socket handler", () => {
  test("several subscriptions share one socket", async () => {
    const { client, close } = connect();
    const org = await client.events.orgStream();
    const project = await client.events.stream({ projectId: "a" });
    const tail = await client.project.logs.tail();

    expect(await take(org, 2)).toEqual(["org:0", "org:1"]);
    expect(await take(project, 2)).toEqual(["project-a:0", "project-a:1"]);
    expect(await take(tail, 1)).toEqual(["tail:0"]);
    close();
  });

  test("unsubscribing one stream leaves the others running", async () => {
    const { client, close, finalized } = connect();
    const controller = new AbortController();
    const tail = await client.project.logs.tail(undefined, { signal: controller.signal });
    const org = await client.events.orgStream();
    await take(tail, 1);

    controller.abort();
    await expect.poll(() => finalized).toContain("tail");
    expect(await take(org, 2)).toHaveLength(2);
    expect(finalized).not.toContain("org");
    close();
  });

  test("closing the socket finalizes every stream on it", async () => {
    const { client, close, finalized } = connect();
    const org = await client.events.orgStream();
    const project = await client.events.stream({ projectId: "b" });
    await take(org, 1);
    await take(project, 1);

    close();
    await expect.poll(() => finalized.toSorted()).toEqual(["org", "project-b"]);
  });

  test("a procedure that is not a live subscription is refused", async () => {
    const { client, close } = connect();
    const refused = await Result.tryPromise({
      try: () => client.project.update(),
      catch: (error) => error,
    });
    const error = refused.isErr() ? refused.error : null;
    expect(error).toBeInstanceOf(ORPCError);
    expect(error instanceof ORPCError ? error.status : null).toBe(404);
    close();
  });
});
