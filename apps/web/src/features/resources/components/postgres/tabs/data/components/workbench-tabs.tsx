/**
 * The tab strip across the top of the workbench content: open tables and open
 * queries side by side, because switching between "the rows" and "the query I
 * am writing about them" is the workbench's core loop and a tab is the
 * cheapest way to keep both a click away.
 *
 * Rendered by both layouts (table browser and SQL playground) above their
 * toolbars, so the strip never disappears when the mode changes — the mode IS
 * just which tab is active.
 */
import {
  Cancel01Icon,
  PlusSignIcon,
  SourceCodeIcon,
  Table01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { cn } from "@/shared/lib/utils";

import type { DataStudioController } from "../use-data-studio";
import type { WorkbenchTab } from "../use-workbench-tabs";

import { PLAYGROUND_ID } from "../data/use-sql-snippets";
import { workbenchTabId } from "../use-workbench-tabs";

export function WorkbenchTabs({ studio }: { studio: DataStudioController }) {
  const { list, activeId, activate, close } = studio.tabs;
  if (list.length === 0) return null;

  // Resolved at render so a snippet rename shows up immediately.
  const titleOf = (tab: WorkbenchTab): string => {
    if (tab.kind === "table") {
      return tab.schema === "public" || tab.schema === "" ? tab.name : `${tab.schema}.${tab.name}`;
    }
    if (tab.snippetId === PLAYGROUND_ID) return "Playground";
    return studio.editor.snippets.find((s) => s.id === tab.snippetId)?.name ?? "Query";
  };

  return (
    <div className="flex h-9 shrink-0 items-stretch overflow-x-auto border-b">
      {list.map((tab) => {
        const id = workbenchTabId(tab);
        const isActive = id === activeId;
        const title = titleOf(tab);
        return (
          <div
            key={id}
            className={cn(
              "group relative flex shrink-0 items-center border-r",
              isActive ? "bg-background" : "hover:bg-muted/40",
            )}
          >
            {/* The active marker sits on TOP of the tab — where it cannot be
                mistaken for the border between the strip and the toolbar. */}
            {isActive ? (
              <span aria-hidden className="absolute inset-x-0 top-0 h-0.5 bg-primary" />
            ) : null}
            <button
              type="button"
              onClick={() => activate(tab)}
              className={cn(
                "flex h-full items-center gap-1.5 pr-1 pl-3 text-[12.5px]",
                isActive ? "text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <HugeiconsIcon
                icon={tab.kind === "table" ? Table01Icon : SourceCodeIcon}
                strokeWidth={2}
                className="size-3.5 shrink-0 opacity-60"
              />
              <span className="max-w-44 truncate">{title}</span>
            </button>
            <button
              type="button"
              aria-label={`Close ${title}`}
              onClick={() => close(id)}
              className={cn(
                "mr-1.5 rounded-sm p-0.5 text-muted-foreground transition-opacity hover:bg-muted hover:text-foreground",
                // Always there on the active tab; earned by hover elsewhere so
                // eighty tabs do not read as eighty × buttons.
                isActive ? "" : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
              )}
            >
              <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} className="size-3" />
            </button>
          </div>
        );
      })}
      <button
        type="button"
        aria-label="New query"
        onClick={studio.newQuery}
        className="flex w-9 shrink-0 items-center justify-center text-muted-foreground hover:bg-muted/40 hover:text-foreground"
      >
        <HugeiconsIcon icon={PlusSignIcon} strokeWidth={2} className="size-3.5" />
      </button>
    </div>
  );
}
