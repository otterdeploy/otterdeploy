/**
 * The server half of the live socket: the oRPC handler that
 * serves `LIVE_SOCKET_PROCEDURES` over one WebSocket per dashboard tab.
 *
 * It is oRPC's own Bun WebSocket adapter. Each subscription is a request
 * message on the socket, each unsubscribe an abort message, and any number of
 * them share the connection; closing the socket aborts every stream still on
 * it, which finalizes their generators (Redis subscribers, docker log
 * attachments) exactly as a dropped HTTP request does.
 *
 * Two things differ from the HTTP handler, both in the root interceptor:
 *
 *   - The client builds the same request it would send over HTTP, so the
 *     path still carries `/rpc`. The prefix is applied here rather than by
 *     the adapter, which has no prefix option.
 *   - Only the live-socket procedures are served. Everything else is refused
 *     as unmatched (the client sees a 404): ordinary calls and the
 *     request-bound streams belong on HTTP, and a socket that answered
 *     anything would quietly become a second API surface with none of the
 *     HTTP path's per-request handling.
 */
import type { Context } from "@orpc/server";

import { RPCHandler } from "@orpc/server/bun-ws";

import { LIVE_SOCKET_RPC_PREFIX, isLiveSocketPathname } from "./live-socket";

type LiveSocketHandlerOptions<T extends Context> = NonNullable<
  ConstructorParameters<typeof RPCHandler<T>>[1]
>;

export type LiveSocketRpcHandler<T extends Context> = RPCHandler<T>;

export function createLiveSocketRpcHandler<T extends Context>(
  router: ConstructorParameters<typeof RPCHandler<T>>[0],
  options: Pick<LiveSocketHandlerOptions<T>, "interceptors"> = {},
): LiveSocketRpcHandler<T> {
  return new RPCHandler<T>(router, {
    ...options,
    rootInterceptors: [
      async (handle) => {
        if (!isLiveSocketPathname(handle.request.url.pathname)) {
          return { matched: false, response: undefined };
        }
        return handle.next({ ...handle, prefix: LIVE_SOCKET_RPC_PREFIX });
      },
    ],
  });
}
