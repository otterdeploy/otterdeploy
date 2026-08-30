/**
 * The Firewall's one toolbar.
 *
 * Every tab used to grow a second toolbar of its own below this one, holding
 * its own filters and its own paragraph of prose — so the controls moved
 * vertically as you switched tabs, and the row you were aiming at was in a
 * different place each time. Everything an operator can turn now lives on one
 * strip, in one order, whichever tab is open: what you're looking at, how it's
 * narrowed, and what you're searching for.
 *
 * Below `lg` the strip stacks into three full-width rows (tabs / filters /
 * search) instead of wrapping mid-control, and each row scrolls sideways on
 * its own so a five-option window picker never squeezes the search box to
 * nothing.
 */
import type { ReactNode } from "react";

import { cn } from "@/shared/lib/utils";

import type { FirewallTab } from "../tabs";

import { FIREWALL_TABS, TAB_LABEL } from "../tabs";
import { Segmented } from "./segmented";

/** A strip that scrolls sideways rather than wrapping, with the scrollbar
 *  itself hidden — on a phone the gesture is the affordance. */
function ScrollRow({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div
      className={cn(
        "-mx-1 flex [scrollbar-width:none] items-center gap-2 overflow-x-auto px-1 [&::-webkit-scrollbar]:hidden",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function FirewallToolbar({
  tab,
  onTabChange,
  counts,
  filters,
  search,
}: {
  tab: FirewallTab;
  onTabChange: (next: FirewallTab) => void;
  /** Per-tab row counts, omitted while a tab hasn't answered yet. */
  counts: Partial<Record<FirewallTab, number>>;
  /** The open tab's own controls. Empty for tabs that have none. */
  filters: ReactNode;
  search: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 border-b px-4 py-2 lg:flex-row lg:items-center lg:gap-3">
      <ScrollRow className="shrink-0">
        <Segmented
          ariaLabel="Firewall section"
          options={FIREWALL_TABS}
          value={tab}
          onChange={onTabChange}
          label={(t) => TAB_LABEL[t]}
          counts={counts}
        />
      </ScrollRow>

      <ScrollRow className="shrink-0 lg:ml-auto">{filters}</ScrollRow>

      {search}
    </div>
  );
}
