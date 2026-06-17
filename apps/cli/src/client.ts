import type { AppRouterClient } from "@otterdeploy/api/routers/index";

import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";

import { fetchFor } from "./lib/local-tls";

interface ClientOptions {
  url: string;
  token?: string;
}

export function createCliClient({ url, token }: ClientOptions): AppRouterClient {
  const link = new RPCLink({
    url: `${url.replace(/\/$/, "")}/rpc`,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    // Trust the dev portless proxy's local cert; no-op for remote hosts.
    fetch: fetchFor(url),
  });
  return createORPCClient(link);
}
