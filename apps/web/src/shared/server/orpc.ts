import type { RouterClient } from "@orpc/server";
import type { AppRouter } from "@otterdeploy/api/routers/index";

import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { ClientRetryPlugin, type ClientRetryPluginContext } from "@orpc/client/plugins";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import { env } from "@otterdeploy/env/web";
import { i18n } from "@otterdeploy/i18n/web";
import { QueryCache, QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { isControlPlaneUnreachable } from "./unreachable";

/**
 * Client call-context for the retry plugin. Per-call `context.retry` opts a
 * single call into reconnect-on-error. That's how our live streams
 * (event-iterators) get EventSource-style auto-reconnect without affecting
 * ordinary queries/mutations, which keep the plugin default of `retry: 0`.
 */
export type ClientContext = ClientRetryPluginContext;

/**
 * One id for the "control plane unreachable" toast, so the twentieth query to
 * fail during a restart replaces that toast instead of stacking a twentieth
 * copy of it. Sonner treats a repeat id as an update in place.
 */
const UNREACHABLE_TOAST_ID = "control-plane-unreachable";

/**
 * Whether that toast is currently up. Module-level because the state belongs to
 * the QueryCache singleton, not to any component: it exists only so a recovery
 * doesn't fire `toast.dismiss` on every successful query for the rest of the
 * session.
 */
let showingUnreachable = false;

export const queryClient = new QueryClient({
  // Without defaults, TanStack Query uses staleTime: 0, so every component
  // remount / back-navigation refetches from the server and shows a spinner,
  // even for data it just had. A modest staleTime serves cached data instantly
  // on navigation while a background refetch keeps it fresh. Live collections
  // that need real-time data set their own refetchInterval, which still wins.
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
    },
  },
  queryCache: new QueryCache({
    onError: (error, query) => {
      // Screens that render a query's failure inline (e.g. the accept-invite
      // card) opt out of this global toast so the same error isn't shown twice.
      if (query.meta?.suppressErrorToast) return;

      // A restarting control plane is not an error the operator can act on, and
      // during a cutover EVERY polling query fails at once. Collapse the whole
      // burst into a single standing notice that says what is happening and
      // that it resolves itself, and leave the red toast for faults that are
      // actually the server's answer. No retry action: retrying into a server
      // that is still coming up just produces another one of these, and the
      // queries resume on their own the moment it answers.
      if (isControlPlaneUnreachable(error)) {
        showingUnreachable = true;
        toast.warning(i18n.t("errors.connection.unreachable"), {
          id: UNREACHABLE_TOAST_ID,
          description: i18n.t("errors.connection.reconnecting"),
          duration: Number.POSITIVE_INFINITY,
        });
        return;
      }

      toast.error(`Error: ${error.message}`, {
        action: {
          label: "retry",
          onClick: () => query.invalidate(),
        },
      });
    },
    // Any query getting through means the control plane is back, so the notice
    // has served its purpose. The flag keeps this to one dismiss per outage
    // instead of a no-op on every successful query for the rest of the session.
    onSuccess: () => {
      if (!showingUnreachable) return;
      showingUnreachable = false;
      toast.dismiss(UNREACHABLE_TOAST_ID);
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

export const client: RouterClient<AppRouter, ClientContext> = createORPCClient(link);

export const orpc = createTanstackQueryUtils(client);
