/**
 * The shared silhouette for everything in the registries grid.
 *
 * Two different things sit in that list — a stored credential and the GHCR
 * entry derived from the workspace's GitHub App — and they were once drawn by
 * two hand-rolled shells that had quietly diverged. They are siblings, so they
 * share a shape here and differ only in what they SAY.
 *
 * EVERYTHING THE CARD KNOWS IS ON THE CARD. An earlier pass pushed auth type,
 * host, username and dates into a hover tooltip to keep the card small. That
 * was wrong twice over: the tooltip mostly REPEATED the face — host and
 * username are already in the `user@host` line, the account is already the
 * subtitle — and the card it left behind was so sparse its footer had nothing
 * to say. A tooltip earns its place when it holds what the face genuinely
 * can't; see channel-head-stats.tsx, where it carries a four-row delivery
 * breakdown. Three facts that fit on one line are not that.
 *
 * ACTIONS ARE ALWAYS VISIBLE, not hover-revealed. Hover-only controls are a
 * density trade — worth it in a fifty-row table, not on a grid of two to four
 * cards, where the only thing they buy is a card that looks unmanageable. They
 * stay `ghost` so they recede without disappearing.
 */

import type { ReactNode } from "react";

import { cn } from "@/shared/lib/utils";

export function RegistryCardShell({
  logo,
  title,
  badge,
  subtitle,
  meta,
  actions,
  tone,
  /** Renders the title in mono. For a bare host (`ghcr.io`) rather than a
   *  human-chosen display name — the Two-Cuts Rule in DESIGN.md. */
  monoTitle = false,
}: {
  logo: ReactNode;
  title: string;
  /** Auth type, or what stands in for it on a managed entry. */
  badge: string;
  /** The machine-readable identity line: `user@host`, or the account. */
  subtitle: string;
  /** Low-emphasis facts that describe the registry without identifying it —
   *  what depends on it, when it was added. */
  meta: ReactNode;
  actions?: ReactNode;
  /** `ok` — something depends on this. `idle` — stored but nothing uses it.
   *  Deliberately NOT connection health, which this app never stores, so the
   *  dot can never be claiming "reachable". */
  tone: "ok" | "idle";
  monoTitle?: boolean;
}) {
  return (
    <div className="flex h-full flex-col gap-2.5 rounded-xl border bg-card p-3.5 transition-colors hover:border-foreground/20">
      <div className="flex min-w-0 items-center gap-2">
        <span className="shrink-0">{logo}</span>
        <span
          className={cn("min-w-0 truncate text-[13px] font-semibold", monoTitle && "font-mono")}
        >
          {title}
        </span>
        <span className="shrink-0 rounded-sm bg-muted px-1.5 py-0.5 text-[10px] font-medium tracking-wider text-muted-foreground uppercase">
          {badge}
        </span>
        <span className="flex-1" />
        {/* The dot repeats what the meta line says in words, so it stays out of
            the accessibility tree. */}
        <span
          aria-hidden
          className={cn(
            "size-1.5 shrink-0 rounded-full",
            tone === "ok" ? "bg-emerald-500" : "bg-amber-500",
          )}
        />
      </div>

      <div className="truncate font-mono text-[11px] text-muted-foreground" title={subtitle}>
        {subtitle}
      </div>

      <div className="mt-auto flex min-h-7 items-center justify-between gap-2 border-t pt-2.5">
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
          {meta}
        </span>
        {actions !== undefined && (
          <span className="flex shrink-0 items-center gap-0.5">{actions}</span>
        )}
      </div>
    </div>
  );
}
