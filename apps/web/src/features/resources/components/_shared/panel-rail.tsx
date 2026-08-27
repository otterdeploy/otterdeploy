/**
 * The rail: the expanded panel's tab column, and the table of contents for
 * whatever tab is open.
 *
 * Split from panel-tabs-layout on the file-length cap, and it splits cleanly:
 * everything here is about ONE idea — a guide line with a marker that moves —
 * while that file is about which chrome a width gets.
 */

import type { RefObject } from "react";
import { useLayoutEffect, useRef, useState } from "react";

import { TabsList, TabsTrigger } from "@/shared/components/ui/tabs";
import { cn } from "@/shared/lib/utils";

import type { PanelRailChild, PanelTabDef } from "./panel-tabs-layout";

import { usePanelSections } from "./panel-sections";

/**
 * The rail: a guide line down the left with the open item's segment lit.
 *
 * The first version boxed the active tab in a rounded rectangle, which read as
 * a button parked in a column of plain text — a different idea of "selected"
 * from the sliding underline the strip uses two pixels away. This is the same
 * idea turned on its side: one continuous hairline, and an accent segment that
 * MOVES to whatever is open rather than a box that blinks on around it.
 *
 * When the open tab has sections, they hang off the same line one step in and
 * the marker moves down to them — so a long Settings scroll reads as a table
 * of contents with your place in it, and the marker's horizontal step is the
 * thing that says "you are inside this tab".
 */
export function PanelRail<T extends string>({
  tabs,
  value,
  nested,
}: {
  tabs: PanelTabDef<T>[];
  value: T;
  nested?: { under: T; items: PanelRailChild[] };
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const { sections, activeId, goTo } = usePanelSections(value);
  const indicator = useRailIndicator(listRef, [
    value,
    activeId,
    sections.length,
    nested?.items.length,
  ]);

  return (
    // Scrolls on its own so a stack with twenty services doesn't push the
    // pane's scrollbar around; `shrink-0` is what keeps it 188px rather than
    // letting a long service name widen it.
    <div className="w-[188px] shrink-0 overflow-y-auto border-r border-border/60 py-3 pr-2.5 pl-4">
      <div ref={listRef} className="relative">
        {/* The line every item hangs off. One element, full height, so the
            column reads as continuous rather than as a stack of loose rows. */}
        <span aria-hidden className="absolute top-0 bottom-0 left-0 w-px bg-border" />
        {/* The lit segment. Animates on the same 300ms ease-out the strip's
            underline uses, so both widths of this panel move identically —
            including `left`, which is what makes it step in and out of a
            tab's sections instead of jumping. */}
        <span
          aria-hidden
          className="pointer-events-none absolute w-0.5 rounded-full bg-primary transition-[top,height,left] duration-300 ease-out"
          style={{
            top: indicator.top,
            height: indicator.height,
            left: indicator.left,
            opacity: indicator.height > 0 ? 1 : 0,
          }}
        />

        <TabsList
          variant="default"
          className="flex h-auto w-full flex-col items-stretch gap-0 bg-transparent p-0"
        >
          {tabs.map((tab) => {
            const isActive = tab.value === value;
            // Sections take the marker when the open tab has them: the
            // finer-grained "where am I" wins, as it does in a docs sidebar.
            const showSections = isActive && sections.length > 1;
            return (
              <div key={tab.value} className="contents">
                <TabsTrigger
                  value={tab.value}
                  disabled={tab.disabled}
                  // ONLY the marked item carries this. The indicator finds it
                  // by query, so a second tagged element would silently win by
                  // being earlier in the document.
                  {...(isActive && !showSections ? { "data-rail-indent": "0" } : {})}
                  className={cn(
                    "h-auto w-full justify-start gap-2 rounded-none py-1.5 pr-2 pl-3 text-[13px]",
                    "transition-colors hover:text-foreground",
                    // The rail paints its own marker, so every trace of the
                    // default variant's active pill has to go — including the
                    // dark-mode fill and border, which are separate rules.
                    "border-transparent bg-transparent shadow-none",
                    "data-active:border-transparent data-active:bg-transparent data-active:shadow-none",
                    "dark:data-active:border-transparent dark:data-active:bg-transparent",
                    // This one has to be spelled with the group prefix or it
                    // does not win: tailwind-merge treats a group-scoped
                    // `shadow-sm` as a different key from a plain one, so the
                    // default variant's raised-card shadow survived every
                    // unprefixed override and drew the box this rail exists to
                    // get rid of.
                    "group-data-[variant=default]/tabs-list:data-active:shadow-none",
                    "group-data-[variant=default]/tabs-list:flex-none",
                    isActive ? "font-medium text-foreground" : "text-muted-foreground",
                  )}
                >
                  {tab.label}
                  {tab.count != null && (
                    <span className="ml-auto font-mono text-[11px] text-muted-foreground">
                      {tab.count}
                    </span>
                  )}
                </TabsTrigger>

                {showSections && (
                  <div className="relative">
                    {/* The sections' own hairline starts where they do, which
                        is what gives the column its step rather than one flat
                        ruler from top to bottom. */}
                    <span aria-hidden className="absolute top-0 bottom-0 left-3 w-px bg-border" />
                    {sections.map((section) => {
                      const here = section.id === activeId;
                      return (
                        <button
                          key={section.id}
                          type="button"
                          {...(here ? { "data-rail-indent": "12" } : {})}
                          onClick={() => {
                            goTo(section.id);
                          }}
                          className={cn(
                            "block w-full py-1 pr-2 pl-6 text-left text-[12.5px] transition-colors",
                            "hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none",
                            here ? "font-medium text-foreground" : "text-muted-foreground/80",
                          )}
                        >
                          {section.title}
                        </button>
                      );
                    })}
                  </div>
                )}

                {nested?.under === tab.value &&
                  nested.items.map((child) => (
                    <RailChild key={child.id} child={child} active={isActive} />
                  ))}
              </div>
            );
          })}
        </TabsList>
      </div>
    </div>
  );
}

/**
 * Where the lit segment sits: the bounds of the marked item, measured from the
 * DOM rather than computed from a row height, because rail rows are not all
 * the same height (a wrapped section title is two lines).
 *
 * Same shape as the strip's indicator in `ui/tabs`: measure on layout, and
 * re-measure whenever the rail's contents or size change, so the segment
 * cannot drift from the thing it marks.
 */
function useRailIndicator(
  listRef: RefObject<HTMLDivElement | null>,
  deps: unknown[],
): { top: number; height: number; left: number } {
  const [indicator, setIndicator] = useState({ top: 0, height: 0, left: 0 });

  useLayoutEffect(() => {
    const node = listRef.current;
    if (!node) return;
    const measure = () => {
      const marked = node.querySelector<HTMLElement>("[data-rail-indent]");
      if (!marked) {
        setIndicator((prev) => (prev.height === 0 ? prev : { ...prev, height: 0 }));
        return;
      }
      // Rects, not offsetTop: the marked element sits inside a TabsList and,
      // for a section, inside its own wrapper, so its offsetParent is not the
      // container the bar is positioned against.
      const box = node.getBoundingClientRect();
      const target = marked.getBoundingClientRect();
      const next = {
        top: target.top - box.top,
        height: target.height,
        left: Number(marked.dataset.railIndent ?? 0),
      };
      setIndicator((prev) =>
        prev.top === next.top && prev.height === next.height && prev.left === next.left
          ? prev
          : next,
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    // childList too: a tab switch replaces the section list wholesale, and
    // watching only attributes would leave the marker on a row that is gone.
    const mutations = new MutationObserver(measure);
    mutations.observe(node, {
      attributes: true,
      attributeFilter: ["data-rail-indent"],
      childList: true,
      subtree: true,
    });
    return () => {
      observer.disconnect();
      mutations.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- callers pass what changes
  }, [listRef, ...deps]);

  return indicator;
}

/** A stack member. A button, not a tab: it navigates to another resource
 *  rather than switching panes, so making it a TabsTrigger would leave the
 *  rail showing a selection that isn't this panel's. */
function RailChild({ child, active }: { child: PanelRailChild; active: boolean }) {
  return (
    <button
      type="button"
      onClick={child.onOpen}
      className={cn(
        "relative flex items-center gap-2 rounded-md py-1.5 pr-2.5 pl-6 text-left text-[12.5px]",
        "text-muted-foreground transition-colors hover:text-foreground",
        "focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none",
        // Hangs off the same stepped line the sections use.
        "before:absolute before:top-0 before:bottom-0 before:left-3 before:w-px before:bg-border",
        !active && "opacity-80",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          child.dotClass ?? "ring-1 ring-muted-foreground/40",
        )}
      />
      <span className="min-w-0 truncate">{child.label}</span>
    </button>
  );
}
