/**
 * The tab chrome every resource panel wears, in both of the drawer's widths.
 *
 * Collapsed it is the horizontal strip it has always been. Expanded, the tabs
 * become a fixed 188px rail down the left and the pane takes everything else —
 * which is the only reason an expand control is worth having. Stretching one
 * column to 1600px makes a compose file harder to read, not easier; moving the
 * tabs out of the content's way is what turns the extra width into a wider
 * editor and a longer log.
 *
 * The rail is FIXED. Only the pane grows, so the tabs don't drift further from
 * the content the wider the screen gets.
 *
 * A compose stack additionally nests its children under one of its tabs, so
 * you can move between the stack and its services without leaving the panel.
 * Selecting one navigates (it is a real resource with its own URL) rather than
 * swapping local state — see panel-breadcrumb for the other half of that move.
 */

import type { ReactNode, RefObject } from "react";
import { createContext, useContext, useRef } from "react";

import { Tabs, TabsList, TabsTrigger } from "@/shared/components/ui/tabs";
import { cn } from "@/shared/lib/utils";

import { PanelRail } from "./panel-rail";
import { PanelSectionsProvider } from "./panel-sections";
import { PANEL_TAB_BODY_CLASS } from "./panel-tab";
import { usePanelExpanded } from "./panel-width";

export interface PanelTabDef<T extends string = string> {
  value: T;
  label: string;
  disabled?: boolean;
  /** Count shown at the rail's trailing edge. The horizontal strip has no room
   *  for it, which is part of what the rail buys. */
  count?: number;
}

export interface PanelRailChild {
  id: string;
  label: string;
  /** Dot colour class, e.g. `bg-success`. Omitted → a hollow ring, which is
   *  the honest rendering of "no status yet". */
  dotClass?: string;
  onOpen: () => void;
}

/**
 * `<Tabs>` plus the strip-or-rail nav, WITHOUT a body.
 *
 * For panels that own their content region: the service panel keeps Logs and
 * Terminal absolutely positioned and mounted across tab switches, and the
 * database panel does the same for its terminal. Handing them a scroll
 * container would break both.
 */
export function PanelTabsChrome<T extends string>({
  tabs,
  value,
  onValueChange,
  children,
  nested,
}: {
  tabs: PanelTabDef<T>[];
  value: T;
  /** Typed to the panel's own tab union. The primitive hands back a plain
   *  string, which is narrowed below by finding it among the declared tabs —
   *  a real check, not an assertion, so an unknown value is ignored rather
   *  than forced into a type it isn't. */
  onValueChange: (value: T) => void;
  children: ReactNode;
  nested?: { under: T; items: PanelRailChild[] };
}) {
  const expanded = usePanelExpanded();
  const scrollRef = useRef<HTMLDivElement>(null);
  return (
    <PanelSectionsProvider scrollRef={scrollRef}>
      <Tabs
        value={value}
        orientation={expanded ? "vertical" : "horizontal"}
        onValueChange={(next) => {
          const picked = tabs.find((tab) => tab.value === next);
          if (picked) onValueChange(picked.value);
        }}
        className={cn("flex min-h-0 flex-1 gap-0", expanded ? "flex-row" : "flex-col")}
      >
        {expanded ? (
          <PanelRail tabs={tabs} value={value} nested={nested} />
        ) : (
          <div className="border-b border-border/60 px-4 sm:px-6">
            <TabsList variant="line" className="h-auto bg-transparent p-0">
              {tabs.map((tab) => (
                <TabsTrigger
                  key={tab.value}
                  value={tab.value}
                  className="px-2.5 py-2.5"
                  disabled={tab.disabled}
                >
                  {tab.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>
        )}
        <PaneScrollContext.Provider value={scrollRef}>{children}</PaneScrollContext.Provider>
      </Tabs>
    </PanelSectionsProvider>
  );
}

/** The pane's scroll element, so PanelTabsLayout can attach the ref the
 *  section observer roots on without every panel threading it. */
const PaneScrollContext = createContext<RefObject<HTMLDivElement | null> | null>(null);

/** Chrome + the standard scrolling body. What a panel wants unless it has a
 *  reason not to. */
export function PanelTabsLayout<T extends string>({
  children,
  ...chrome
}: {
  tabs: PanelTabDef<T>[];
  value: T;
  onValueChange: (value: T) => void;
  children: ReactNode;
  nested?: { under: T; items: PanelRailChild[] };
}) {
  return (
    <PanelTabsChrome {...chrome}>
      <PaneBody>{children}</PaneBody>
    </PanelTabsChrome>
  );
}

function PaneBody({ children }: { children: ReactNode }) {
  const scrollRef = useContext(PaneScrollContext);
  return (
    <div className="relative min-h-0 min-w-0 flex-1">
      <div ref={scrollRef} className="h-full overflow-y-auto">
        <div className={PANEL_TAB_BODY_CLASS}>{children}</div>
      </div>
    </div>
  );
}
