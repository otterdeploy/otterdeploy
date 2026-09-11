/**
 * The live-log table preview harness (od-fqhk).
 *
 * Five surfaces are moving onto one shell. This mounts each of them on that
 * shell, with fixtures in place of an endpoint, so the migration can be judged
 * before any of it is wired — one surface at a time, switched from the rail.
 *
 * Run it with `bunx vite dev` in apps/web and open `/preview.html`. It needs no
 * server, no session and no database: everything it renders is client-side.
 *
 * Not part of the app. No route points here, and the whole directory goes when
 * the last surface has a real feed.
 */

import { Fragment, StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";

import { i18n } from "@otterdeploy/i18n/web";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";

import { SURFACES } from "@/preview/surfaces";
import { ThemeProvider } from "@/shared/components/theme-provider";
import { Toaster } from "@/shared/components/ui/sonner";
import { TooltipProvider } from "@/shared/components/ui/tooltip";
import { cn } from "@/shared/lib/utils";
import "@/index.css";

/**
 * The app's providers, minus the router and the oRPC client.
 *
 * Its own `QueryClient` rather than the app's: importing `shared/server/orpc`
 * would pull in the API client and its base URL, and the whole point of this
 * harness is that it runs with no server behind it.
 */
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
});

function Harness() {
  const [activeId, setActiveId] = useState(SURFACES[0].id);
  const active = SURFACES.find((surface) => surface.id === activeId) ?? SURFACES[0];

  return (
    <div className="flex h-svh min-h-0 w-full overflow-hidden bg-background text-foreground">
      <aside className="flex w-64 shrink-0 flex-col gap-1 overflow-y-auto border-r p-3">
        <p className="px-2 pt-1 pb-2 font-mono text-[10px] tracking-wide text-muted-foreground uppercase">
          Live-log surfaces
        </p>
        {SURFACES.map((surface, index) => (
          <button
            key={surface.id}
            type="button"
            onClick={() => setActiveId(surface.id)}
            className={cn(
              "rounded-md px-2 py-2 text-left text-[13px] transition-colors",
              surface.id === activeId
                ? "bg-muted font-medium text-foreground"
                : "text-muted-foreground hover:bg-muted/50",
            )}
          >
            <span className="flex items-baseline gap-2">
              <span className="font-mono text-[10px] text-muted-foreground/60">{index + 1}</span>
              {surface.title}
            </span>
            <span className="mt-0.5 block pl-5 text-[11px] text-muted-foreground/70">
              {surface.replaces}
            </span>
          </button>
        ))}
        <p className="mt-auto px-2 pt-4 text-[11px] leading-relaxed text-muted-foreground/70">
          The real shell, the real columns, fixtures instead of an endpoint. Filters, facets and the
          histogram run through the same engine the server compiles to SQL.
        </p>
      </aside>

      <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <header className="shrink-0 px-6 py-4">
          <h1 className="text-2xl font-semibold tracking-tight">{active.title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{active.where}</p>
        </header>
        {/* Keyed so switching surfaces starts each one clean, the way arriving
            at its route would — rather than inheriting the last one's filters. */}
        <Fragment key={active.id}>{active.render()}</Fragment>
      </main>
      <Toaster />
    </div>
  );
}

const container = document.getElementById("root");
if (!container) throw new Error("preview root missing");

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={i18n}>
        <ThemeProvider defaultTheme="light" storageKey="otterdeploy-preview-theme">
          <TooltipProvider>
            <Harness />
          </TooltipProvider>
        </ThemeProvider>
      </I18nextProvider>
    </QueryClientProvider>
  </StrictMode>,
);
