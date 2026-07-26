import type { QueryClient } from "@tanstack/react-query";

import { HeadContent, Outlet, createRootRouteWithContext } from "@tanstack/react-router";

import type { orpc } from "@/shared/server/orpc";

import { ThemeProvider } from "@/shared/components/theme-provider";
import { Toaster } from "@/shared/components/ui/sonner";
import { TooltipProvider } from "@/shared/components/ui/tooltip";
import { useDocumentTitle } from "@/shared/hooks/use-document-title";

import "../index.css";

export interface RouterAppContext {
  orpc: typeof orpc;
  queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterAppContext>()({
  component: RootComponent,
  // Fallback title only. Every route below sets its own, and the deepest match
  // wins — the product name is not repeated onto pages that have a real name of
  // their own. See docs: the tab should say where you are, not what app it is.
  //
  // No `links` here on purpose. Icon declarations live in apps/web/index.html so
  // they apply before JS boots, and so HeadContent's re-render cannot clobber
  // the live favicon the status controller paints (shared/lib/favicon.ts).
  head: () => ({
    meta: [
      { title: "otterdeploy" },
      {
        name: "description",
        content:
          "Self-hostable deployments — build, ship, and operate your services on your own servers.",
      },
    ],
  }),
});

function RootComponent() {
  // Owns document.title for every route (see the hook for why the product name
  // is not appended). It runs after HeadContent renders the fallback, so the
  // real page name wins.
  useDocumentTitle();

  return (
    <>
      <HeadContent />
      <ThemeProvider
        attribute="class"
        defaultTheme="dark"
        disableTransitionOnChange
        storageKey="vite-ui-theme"
      >
        <TooltipProvider>
          <div className="grid h-svh grid-rows-[auto_1fr]">
            <Outlet />
          </div>
          <Toaster richColors />
        </TooltipProvider>
      </ThemeProvider>

      {/*<TanStackRouterDevtools position="bottom-left" />
      <ReactQueryDevtools position="bottom" buttonPosition="bottom-right" />*/}
    </>
  );
}
