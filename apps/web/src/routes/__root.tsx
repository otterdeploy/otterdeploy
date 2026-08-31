import type { QueryClient } from "@tanstack/react-query";

import { HeadContent, Outlet, createRootRouteWithContext } from "@tanstack/react-router";
import * as z from "zod";

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
  // The new-resource wizard's URL handoff (`?new=service`, or
  // `?new=template&template=<id>`). Declared at the root because no single
  // route owns it: it's produced from the templates gallery and the GitHub
  // connect returnTo, and consumed by ResourceOverlayProvider up in `_app`.
  // Declaring it is what lets that provider read and clear it through the
  // typed search API instead of the raw history object.
  validateSearch: z.object({
    new: z.enum(["service", "template"]).optional(),
    template: z.string().optional(),
  }),
  // Fallback title only. Every route below sets its own, and the deepest match
  // wins: the product name is not repeated onto pages that have a real name of
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
          "Self-hostable deployments. Build, ship, and operate your services on your own servers.",
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
        defaultTheme="light"
        disableTransitionOnChange
        storageKey="vite-ui-theme"
      >
        <TooltipProvider>
          {/* grid-cols-[minmax(0,1fr)], not the implicit `1fr`: a grid item's
              default `min-width:auto` floors it at min-content, so ONE wide
              child deep in the tree (a fixed-column table, a long log line)
              stretched the whole app past the viewport on a phone: header,
              tiles and all: instead of scrolling inside its own container. */}
          <div className="grid h-svh grid-cols-[minmax(0,1fr)] grid-rows-[auto_1fr]">
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
