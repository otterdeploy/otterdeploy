/**
 * The rows of the target switcher: one database, and the tag strip that
 * narrows the external ones. Split from the switcher to keep it under the
 * line cap; nothing here knows about the menu it sits in beyond the item
 * primitive.
 */
import { Settings01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { DatabaseLogo } from "@/shared/components/brand/database-logo";
import { DropdownMenuItem } from "@/shared/components/ui/dropdown-menu";
import { cn } from "@/shared/lib/utils";

import type { DataConnection } from "../data/connections";
import type { WorkbenchTargetOption } from "../data/use-workbench-targets";

export function TargetItem({
  option,
  active,
  onPick,
  onEdit,
}: {
  option: WorkbenchTargetOption;
  active: boolean;
  onPick: (option: WorkbenchTargetOption) => void;
  /** Present for saved connections: the row grows a gear. */
  onEdit?: (connection: DataConnection) => void;
}) {
  const connection = option.connection;
  const editable = connection !== undefined && onEdit !== undefined;
  return (
    <DropdownMenuItem
      disabled={!option.healthy}
      onClick={() => {
        if (option.healthy) onPick(option);
      }}
      // The keyboard cannot hover a row to reach its gear, so → on a
      // highlighted saved connection opens its settings — the same idiom as
      // stepping into a submenu, which is what settings are to a row.
      onKeyDown={(e) => {
        if (e.key === "ArrowRight" && connection !== undefined && onEdit !== undefined) {
          e.preventDefault();
          onEdit(connection);
        }
      }}
      title={editable ? "→ opens settings" : undefined}
      className={cn("group/row gap-2", active && "bg-accent")}
    >
      <DatabaseLogo value={option.engine} size={20} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-[13px] font-medium">{option.name}</span>
          {/* Two chips at most in a row that is a place to go, not a card;
              the rest are one glance away in the filter strip. */}
          {option.tags.slice(0, 2).map((tag) => (
            <span
              key={tag}
              className="shrink-0 rounded bg-muted px-1 py-px font-mono text-[9.5px] text-muted-foreground"
            >
              {tag}
            </span>
          ))}
          {option.tags.length > 2 ? (
            <span className="shrink-0 font-mono text-[9.5px] text-muted-foreground/70">
              +{option.tags.length - 2}
            </span>
          ) : null}
        </span>
        <span className="truncate font-mono text-[10.5px] text-muted-foreground">
          {option.subtitle}
        </span>
      </span>
      {!option.healthy ? (
        <span className="shrink-0 font-mono text-[9.5px] tracking-wide text-warning uppercase">
          down
        </span>
      ) : null}
      {connection !== undefined && onEdit !== undefined ? (
        // Hidden until the row is hovered or highlighted, so a list of six
        // connections is not a list of six gears; always shown where there is
        // no hover to reveal it (touch). Its click is ITS click: stopped here
        // so the row does not also switch databases underneath the dialog.
        <button
          type="button"
          aria-label={`Settings for ${option.name}`}
          title="Connection settings"
          onClick={(e) => {
            e.stopPropagation();
            onEdit(connection);
          }}
          className="-mr-0.5 shrink-0 rounded-md p-1 text-muted-foreground opacity-0 transition-opacity group-hover/row:opacity-100 group-data-highlighted/row:opacity-100 hover:bg-foreground/10 hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none pointer-coarse:opacity-100"
        >
          <HugeiconsIcon icon={Settings01Icon} strokeWidth={2} className="size-3.5" />
        </button>
      ) : null}
    </DropdownMenuItem>
  );
}

/**
 * One row of toggles, one active at a time. A second click on the active
 * tag clears it; there is no separate "all" chip to keep in step.
 *
 * Plain buttons, not menu items: picking a tag must not close the menu.
 */
export function TagStrip({
  tags,
  selected,
  onSelect,
}: {
  tags: readonly string[];
  selected: string | null;
  onSelect: (tag: string | null) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Filter by tag"
      className="flex flex-wrap gap-1 px-2 pt-0.5 pb-1.5"
    >
      {tags.map((tag) => {
        const on = tag === selected;
        return (
          <button
            key={tag}
            type="button"
            aria-pressed={on}
            onClick={() => onSelect(on ? null : tag)}
            className={cn(
              "rounded px-1.5 py-0.5 font-mono text-[10.5px] transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none",
              on
                ? "bg-foreground text-background"
                : "bg-muted text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            {tag}
          </button>
        );
      })}
    </div>
  );
}
