import type { AppRouter } from "@otterdeploy/api/routers/index";

import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import {
  ClientRetryPlugin,
  type ClientRetryPluginContext,
} from "@orpc/client/plugins";
import type { RouterClient } from "@orpc/server";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import { env } from "@otterdeploy/env/web";
import { QueryCache, QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

/**
 * Client call-context for the retry plugin. Per-call `context.retry` opts a
 * single call into reconnect-on-error — that's how our live streams
 * (event-iterators) get EventSource-style auto-reconnect without affecting
 * ordinary queries/mutations, which keep the plugin default of `retry: 0`.
 */
export type ClientContext = ClientRetryPluginContext;

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

const link = new RPCLink<ClientContext>({
  url: `${env.VITE_SERVER_URL}/rpc`,
  fetch: (input, init) =>
    fetch(input, {
      ...init,
      credentials: "include",
    }),
  // Reconnect/retry is opt-in per call via `context.retry` (default 0 here,
  // so non-streaming calls are untouched). Live-tail hooks pass
  // `context: { retry: Number.POSITIVE_INFINITY }` to mirror EventSource's
  // automatic reconnection.
  plugins: [new ClientRetryPlugin()],
});

export const client: RouterClient<AppRouter, ClientContext> =
  createORPCClient(link);

export const orpc = createTanstackQueryUtils(client);
