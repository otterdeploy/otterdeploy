import type { AppRouterClient } from "@otterdeploy/api/routers/index";

import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import { env } from "@otterdeploy/env/web";
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

const link = new RPCLink({
  url: `${env.VITE_SERVER_URL}/rpc`,
  fetch: (input, init) =>
    fetch(input, {
      ...init,
      credentials: "include",
    }),
});

export const client: AppRouterClient = createORPCClient(link);

export const orpc = createTanstackQueryUtils(client);
