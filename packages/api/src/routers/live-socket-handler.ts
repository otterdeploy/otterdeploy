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
 * Three things differ from the HTTP handler, all in the root interceptor:
 *
 *   - The client builds the same request it would send over HTTP, so the
 *     path still carries `/rpc`. The prefix is applied here rather than by
 *     the adapter, which has no prefix option.
 *   - Only the live-socket procedures are served. Everything else is refused
 *     as unmatched (the client sees a 404): ordinary calls and the
 *     request-bound streams belong on HTTP, and a socket that answered
 *     anything would quietly become a second API surface with none of the
 *     HTTP path's per-request handling.
 *   - The context is built once per subscription from the upgrade request,
 *     which carries the session cookie but not the page's organization (the
 *     dashboard states it per call). `withRequestHeaders` lets the caller take
 *     what it needs from the subscription's own message; in production that
 *     is `carryActingOrganization`, so the org-scoped guard refuses a
 *     subscription from another organization's page exactly as it refuses
 *     the same call over HTTP.
 */
import type { Context } from "@orpc/server";

import { RPCHandler } from "@orpc/server/bun-ws";

import { ACTING_ORGANIZATION_HEADER } from "../authz/acting-organization";
import { LIVE_SOCKET_RPC_PREFIX, isLiveSocketPathname } from "./live-socket";

/** Request headers as a decoded socket message carries them. */
type MessageHeaders = Readonly<Record<string, string | readonly string[] | undefined>>;

type LiveSocketHandlerOptions<T extends Context> = NonNullable<
  ConstructorParameters<typeof RPCHandler<T>>[1]
>;

export type LiveSocketRpcHandler<T extends Context> = RPCHandler<T>;

export function createLiveSocketRpcHandler<T extends Context>(
  router: ConstructorParameters<typeof RPCHandler<T>>[0],
  options: Pick<LiveSocketHandlerOptions<T>, "interceptors"> & {
    /** The subscription's context, given the headers its message carried. */
    withRequestHeaders?: (context: T, headers: MessageHeaders) => T;
  } = {},
): LiveSocketRpcHandler<T> {
  const { withRequestHeaders, ...handlerOptions } = options;
  return new RPCHandler<T>(router, {
    ...handlerOptions,
    rootInterceptors: [
      async (handle) => {
        if (!isLiveSocketPathname(handle.request.url.pathname)) {
          return { matched: false, response: undefined };
        }
        const context = withRequestHeaders
          ? withRequestHeaders(handle.context, handle.request.headers)
          : handle.context;
        return handle.next({ ...handle, context, prefix: LIVE_SOCKET_RPC_PREFIX });
      },
    ],
  });
}

/**
 * The subscription's context with the page's stated organization from its own
 * message, and nothing else from it: credentials stay the upgrade's, so a
 * message cannot act as anyone the socket was not opened for. A message that
 * states no organization clears one the upgrade request may have carried.
 */
export function carryActingOrganization<C extends { headers: Headers }>(
  context: C,
  messageHeaders: MessageHeaders,
): C {
  const headers = new Headers(context.headers);
  headers.delete(ACTING_ORGANIZATION_HEADER);
  const stated = messageHeaders[ACTING_ORGANIZATION_HEADER];
  const value = Array.isArray(stated) ? stated[0] : stated;
  if (value) headers.set(ACTING_ORGANIZATION_HEADER, value);
  return { ...context, headers };
}
