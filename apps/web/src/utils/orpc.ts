import type { AppRouterClient } from "@otterstack/api/routers/index";

import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import { env } from "@otterstack/env/web";
import { QueryCache, QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

export const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error, query) => {
      toast.error(`Error: ${error.message}`, {
        action: {
          label: "retry",
          onClick: query.invalidate,
        },
      });
    },
  }),
});

let _organizationId: string | null = null;

export function setOrganizationId(id: string | null) {
  _organizationId = id;
}

export function getOrganizationId() {
  return _organizationId;
}

export const link = new RPCLink({
  url: `${env.VITE_SERVER_URL}/rpc`,
  headers: () => {
    const headers: Record<string, string> = {};
    if (_organizationId) {
      headers["x-organization-id"] = _organizationId;
    }
    return headers;
  },
  fetch(url, options) {
    return fetch(url, {
      ...options,
      credentials: "include",
    });
  },
});

export const client: AppRouterClient = createORPCClient(link);

export const orpc = createTanstackQueryUtils(client);
