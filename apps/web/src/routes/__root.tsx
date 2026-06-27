import type { QueryClient } from "@tanstack/react-query";

import { HeadContent, Outlet, createRootRouteWithContext } from "@tanstack/react-router";

import type { orpc } from "@/shared/server/orpc";

import { ThemeProvider } from "@/shared/components/theme-provider";
import { Toaster } from "@/shared/components/ui/sonner";
import { TooltipProvider } from "@/shared/components/ui/tooltip";

import "../index.css";

export interface RouterAppContext {
  orpc: typeof orpc;
  queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterAppContext>()({
  component: RootComponent,
  head: () => ({
    meta: [
      {
        title: "otterdeploy",
      },
      {
        name: "description",
        content: "otterdeploy is a web application",
      },
    ],
    links: [
      {
        rel: "icon",
        href: "/favicon.ico",
      },
    ],
  }),
});

function RootComponent() {
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
