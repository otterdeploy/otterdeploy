/**
 * The shared silhouette for everything in the registries grid.
 *
 * Two different things sit in that list — a stored credential and the GHCR
 * entry derived from the workspace's GitHub App — and they were drawn by two
 * hand-rolled shells that had quietly diverged (`bg-card` on one,
 * `ring-foreground/5` on the other; a 32px logo vs 20px; a `border-t` footer
 * vs none). They are siblings in one list, so they share a shape here and
 * differ only in what they SAY.
 *
 * The whole card is a tooltip trigger. The face carries the four facts that
 * tell one registry from another; `detail` carries the rest. That split is the
 * point: a card that prints auth type, username, host, added and updated is a
 * paragraph, and a grid of paragraphs can't be scanned. Hovering is cheap;
 * reading five lines per card is not.
 *
 * `actions` fade in on hover or keyboard focus (`group-focus-within`, so
 * tabbing reveals them too — hover-only actions are unreachable from a
 * keyboard). At rest the grid stays quiet.
 */

import type { ReactNode } from "react";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/components/ui/tooltip";
import { cn } from "@/shared/lib/utils";

interface DetailRow {
  label: string;
  value: string;
  mono?: boolean;
}

export function RegistryCardShell({
  logo,
  title,
  subtitle,
  stat,
  detail,
  note,
  actions,
  tone,
  /** Renders the title in mono. For a bare host (`ghcr.io`) rather than a
   *  human-chosen display name — the Two-Cuts Rule in DESIGN.md. */
  monoTitle = false,
}: {
  logo: ReactNode;
  title: string;
  subtitle: string;
  /** The one fact on the face. Kept to a single line: two stats and the card
   *  stops being scannable, which is what the tooltip is for. */
  stat: ReactNode;
  detail: DetailRow[];
  note: string;
  actions?: ReactNode;
  /** `ok` — something depends on this. `idle` — stored but nothing uses it.
   *  Deliberately NOT connection health, which this app never stores. */
  tone: "ok" | "idle";
  monoTitle?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <div
            className={cn(
              "group flex cursor-default flex-col gap-2.5 rounded-xl border bg-card p-3.5",
              "transition-colors duration-150 hover:border-foreground/20 hover:bg-accent/20",
            )}
          />
        }
      >
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="shrink-0">{logo}</span>
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-[13px] font-semibold",
              monoTitle && "font-mono",
            )}
          >
            {title}
          </span>
          {/* The dot repeats the footer stat in colour; the stat is the words,
              so the dot stays out of the accessibility tree. */}
          <span
            aria-hidden
            className={cn(
              "size-1.5 shrink-0 rounded-full",
              tone === "ok" ? "bg-emerald-500" : "bg-amber-500",
            )}
          />
        </div>

        <div className="truncate font-mono text-[11px] text-muted-foreground">{subtitle}</div>

        <div className="flex min-h-6 items-center justify-between gap-2 border-t pt-2.5">
          <span className="min-w-0 truncate text-[11px] text-muted-foreground">{stat}</span>
          {actions !== undefined && (
            <span className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
              {actions}
            </span>
          )}
        </div>
      </TooltipTrigger>

      {/* The Popup is an INVERTED surface (bg-foreground / text-background), so
          muted tones here are background-derived rather than the page's
          muted-foreground, which would land grey-on-grey. Mirrors
          channel-head-stats.tsx. */}
      <TooltipContent side="bottom" align="start" className="max-w-72 items-stretch py-2">
        <div className="flex flex-col gap-2">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
            {detail.map((row) => (
              <div key={row.label} className="contents">
                <dt className="whitespace-nowrap text-background/65">{row.label}</dt>
                <dd className={cn("truncate text-right", row.mono && "font-mono")}>{row.value}</dd>
              </div>
            ))}
          </dl>
          <p className="border-t border-background/15 pt-2 text-[11px] text-background/70">
            {note}
          </p>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
