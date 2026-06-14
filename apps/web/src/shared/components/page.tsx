import type { ReactNode } from "react";

import { cn } from "@/shared/lib/utils";

/**
 * Standard shell for org-scoped route pages. One gutter, one vertical rhythm,
 * two width variants — so every page stops picking its own p-4/p-5/p-6 and
 * its own max-width.
 *
 *   - `width="full"`   (default) fills the content area. Use for tables,
 *                      dashboards, and anything that benefits from horizontal
 *                      room (Servers, Docker, Audit, Backups, …).
 *   - `width="narrow"` centers a reading column. Use for forms, settings, and
 *                      card lists where full-bleed rows would sprawl (Settings,
 *                      Team, Git providers, Notifications, …).
 *
 * Pair with {@link PageHeader} for the title block. Full-height "instrument"
 * surfaces (Terminal, Edge logs) are a deliberate exception and own their
 * layout instead of using this.
 */
export function Page({
  width = "full",
  className,
  children,
}: {
  width?: "full" | "narrow";
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex flex-1 flex-col gap-6 p-6",
        width === "narrow" && "mx-auto w-full max-w-3xl",
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * Canonical page header: one title scale (`text-2xl`) and one description scale
 * (`text-sm` muted) across every route, with an optional right-aligned action
 * slot. Replaces the per-page header markup that had drifted to five different
 * title sizes and two different `<h1>`/`<h2>`/`<span>` tags.
 */
export function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("flex items-end justify-between gap-4", className)}>
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description ? (
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex shrink-0 items-center gap-2">{actions}</div>
      ) : null}
    </header>
  );
}
