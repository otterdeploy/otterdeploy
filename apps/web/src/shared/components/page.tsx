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
        // p-4 below `sm`: a 24px gutter costs 48px of a 375px screen.
        // min-w-0 so a wide child (a fixed-column table, a long filesystem
        // path) scrolls inside its own container instead of stretching the
        // page and taking every sibling off-screen with it.
        "flex min-w-0 flex-1 flex-col gap-6 p-4 sm:p-6",
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
    // Below `sm` the actions take their own full-width row UNDER the title.
    // Wrapping alone wasn't enough: the title block is `flex-1`, so it kept
    // shrinking to make room beside two buttons ("Secure enrollment" + "Add
    // server" is ~230px) and the description collapsed into a 5-line column
    // against the left edge. Stacked, the title reads at full width and the
    // buttons get a comfortable touch row.
    <header
      className={cn(
        "flex flex-col items-stretch gap-3",
        "sm:flex-row sm:flex-wrap sm:items-end sm:justify-between sm:gap-x-4 sm:gap-y-3",
        className,
      )}
    >
      <div className="min-w-0 sm:flex-1">
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{title}</h1>
        {description ? (
          <p className="mt-1 text-sm [overflow-wrap:anywhere] text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex flex-wrap items-center gap-2 sm:shrink-0">{actions}</div>
      ) : null}
    </header>
  );
}
