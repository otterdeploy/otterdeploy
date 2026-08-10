import type { AppRouterClient } from "@otterdeploy/api/routers/index";

import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { CLI_VERSION_HEADER } from "@otterdeploy/api/routers/system/compat";

import { observeCompatHeaders } from "./lib/compat";
import { fetchFor } from "./lib/local-tls";
import { CLI_VERSION } from "./version";

interface ClientOptions {
  url: string;
  token?: string;
}

/**
 * Wrap a fetch so every control-plane response feeds the version handshake.
 *
 * Sits at the transport rather than in each command: there is no call path that
 * can skip it, so `otd anything` learns the server's generation for free from
 * the request it was already making. Failures are none of its business. A
 * rejected promise passes straight through to the error boundary.
 */
function observingFetch(inner: typeof fetch): typeof fetch {
  return (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const response = await inner(input, init);
    observeCompatHeaders(response.headers);
    return response;
  }) as typeof fetch;
}

export function createCliClient({ url, token }: ClientOptions): AppRouterClient {
  const link = new RPCLink({
    url: `${url.replace(/\/$/, "")}/rpc`,
    headers: {
      // Stated on every call, so an operator's logs show which CLI generation
      // is talking to them without anyone having to ask the reporter.
      [CLI_VERSION_HEADER]: CLI_VERSION,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    // Trust the dev portless proxy's local cert; no-op for remote hosts.
    fetch: observingFetch(fetchFor(url)),
  });
  return createORPCClient(link);
}
