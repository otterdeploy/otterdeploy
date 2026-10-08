/**
 * The dashboard's oRPC link: one request format, two transports.
 *
 * Every call is built as the RPC request plain HTTP would carry; the live
 * socket (./live-socket.ts) then sends live subscriptions over the tab's one
 * WebSocket and everything else over `fetch`. The retry plugin sits above the
 * transport, so a reconnect picks the socket (or HTTP) afresh instead of
 * retrying into a socket that has closed.
 */
import type { ClientContext } from "@orpc/client";

import { LinkFetchClient } from "@orpc/client/fetch";
import { ClientRetryPlugin, type ClientRetryPluginContext } from "@orpc/client/plugins";
import { StandardRPCLink } from "@orpc/client/standard";
import { LIVE_SOCKET_PATH } from "@otterdeploy/api/routers/live-socket";

import {
  createLiveSocket,
  liveSocketUrl,
  type LiveSocket,
  type LiveSocketOptions,
} from "./live-socket";

export interface AppLinkOptions<T extends ClientContext> extends Pick<
  LiveSocketOptions<T>,
  "createSocket" | "visibility" | "releaseAfterMs" | "retrySocketAfterMs" | "openTimeoutMs"
> {
  /** The control plane's origin, `http(s)://host[:port]`. */
  serverUrl: string;
  fetch: (request: Request, init: { redirect?: Request["redirect"] }) => Promise<Response>;
}

export function createAppLink<T extends ClientRetryPluginContext>(
  options: AppLinkOptions<T>,
): { link: StandardRPCLink<T>; liveSocket: LiveSocket<T> } {
  const http = new LinkFetchClient<T>({ fetch: (request, init) => options.fetch(request, init) });
  const liveSocket = createLiveSocket<T>({
    ...options,
    url: liveSocketUrl(options.serverUrl, LIVE_SOCKET_PATH),
    http,
  });
  const link = new StandardRPCLink<T>(liveSocket, {
    url: `${options.serverUrl}/rpc`,
    // Reconnect/retry is opt-in per call via `context.retry` (default 0 here,
    // so non-streaming calls are untouched). Live-tail hooks pass
    // `context: { retry: Number.POSITIVE_INFINITY }` to mirror EventSource's
    // automatic reconnection.
    plugins: [new ClientRetryPlugin()],
  });
  return { link, liveSocket };
}
