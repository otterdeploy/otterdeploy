import type { QueryClient } from "@tanstack/react-query";
import type { Zero } from "@rocicorp/zero";
import type { Schema } from "@otterdeploy/zero";

import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { HeadContent, Link, Outlet, createRootRouteWithContext } from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";

import { ThemeProvider } from "@/components/theme";
import { orpc } from "@/utils/orpc";
import { Toaster } from "@otterdeploy/ui/components/ui/sonner";
import { TooltipProvider } from "@otterdeploy/ui/components/ui/tooltip";

import "../index.css";

export interface RouterAppContext {
  orpc: typeof orpc;
  queryClient: QueryClient;
  zero?: Zero<Schema>;
}

export const Route = createRootRouteWithContext<RouterAppContext>()({
  component: RootComponent,
  notFoundComponent: NotFound,
  head: () => ({
    meta: [
      {
        title: "otterstack",
      },
      {
        name: "description",
        content: "otterstack is a web application",
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

function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4">
      <p className="text-muted-foreground text-sm">404 Not Found</p>
      <h1 className="text-4xl font-bold">Page not found</h1>
      <p className="text-muted-foreground">
        The page you are looking for doesn't exist.
      </p>
      <Link
        to="/"
        className="mt-4 rounded-lg bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
      >
        Back to Home
      </Link>
    </div>
  );
}

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
          <Outlet />
          <Toaster richColors />
          <div className="fixed bottom-1 left-1 z-50"></div>
        </TooltipProvider>
      </ThemeProvider>

      <TanStackRouterDevtools position="bottom-left" />
      <ReactQueryDevtools position="bottom" buttonPosition="bottom-right" />
    </>
  );
}
