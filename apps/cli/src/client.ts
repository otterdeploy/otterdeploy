import type { AppRouterClient } from "@otterdeploy/api/routers/index";

import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";

interface ClientOptions {
  url: string;
  token?: string;
}

export function createCliClient({ url, token }: ClientOptions): AppRouterClient {
  const link = new RPCLink({
    url: `${url.replace(/\/$/, "")}/rpc`,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  return createORPCClient(link);
}
