// Must run before any feature code — installs crypto.randomUUID over plain HTTP
// (insecure context), where the browser doesn't provide it natively.
import "./lib/random-uuid-polyfill";
import ReactDOM from "react-dom/client";

import { i18n } from "@otterdeploy/i18n/web";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import { I18nextProvider } from "react-i18next";

import { Spinner } from "./shared/components/ui/spinner";
import { routeTree } from "./route-tree.gen";
import { NotFound } from "./shared/features/errors/not-found";
import { ServerError } from "./shared/features/errors/server-error";
import { orpc, queryClient } from "./shared/server/orpc";

// Fallback shown while a route's beforeLoad/loader resolves and the route
// defines no pendingComponent of its own. Without this, a navigation whose
// data hasn't resolved just holds the previous screen with zero feedback —
// the "I clicked and nothing happened for seconds" symptom.
function RoutePending() {
  return (
    <div className="flex min-h-[40vh] w-full items-center justify-center">
      <Spinner className="size-5 text-muted-foreground" />
    </div>
  );
}

const router = createRouter({
  routeTree,
  defaultPreload: "intent",
  defaultPendingComponent: RoutePending,
  // Only surface the spinner if a transition actually takes a beat, so fast
  // (cached) navigations stay flicker-free and feel instant.
  defaultPendingMs: 150,
  defaultErrorComponent: ServerError,
  defaultNotFoundComponent: NotFound,
  context: { orpc, queryClient },
  Wrap: function WrapComponent({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <I18nextProvider i18n={i18n}>
          {children}
          {/*<CommandPalette />*/}
        </I18nextProvider>
      </QueryClientProvider>
    );
  },
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

const rootElement = document.getElementById("app");

if (!rootElement) {
  throw new Error("Root element with id 'app' not found");
}

if (!rootElement.innerHTML) {
  const root = ReactDOM.createRoot(rootElement);
  root.render(<RouterProvider router={router} />);
}
