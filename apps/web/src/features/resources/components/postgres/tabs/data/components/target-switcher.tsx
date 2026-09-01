/**
 * The connection switcher: which database the workbench is pointed at.
 *
 * Managed databases and saved connections sit in one menu under two headings,
 * because to everything downstream they are one thing. The headings exist for
 * the reader, not for the code — a Neon connection and a provisioned Postgres
 * are opened by the same call.
 *
 * A database the runtime cannot reach is listed and greyed rather than hidden.
 * "It is not in the list" and "it is down" are different problems, and a
 * switcher that silently omits the second sends people looking for the first.
 *
 * Tags narrow the external list. They appear as a strip only once a tag
 * exists, so an org with three untagged connections never sees a filter for
 * nothing; the filter is menu-local state and starts clear on every open.
 */
import { useState } from "react";

import { ArrowDown01Icon, PlusSignIcon, Settings01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { DatabaseLogo } from "@/shared/components/brand/database-logo";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/components/ui/dropdown-menu";
import { cn } from "@/shared/lib/utils";

import type { DataConnection } from "../data/connections";
import type { WorkbenchTargetOption } from "../data/use-workbench-targets";

export function TargetSwitcher({
  options,
  active,
  onPick,
  onConnect,
  onEdit,
  isLoading,
}: {
  options: { managed: WorkbenchTargetOption[]; external: WorkbenchTargetOption[] };
  active: WorkbenchTargetOption | undefined;
  onPick: (option: WorkbenchTargetOption) => void;
  onConnect: () => void;
  /** Open the saved connection's settings. Offered for the ACTIVE external target. */
  onEdit: (connection: DataConnection) => void;
  isLoading: boolean;
}) {
  // Controlled so the gear can close the menu itself: its click must not be
  // the row's click (that would switch databases), and a menu left open
  // under the dialog it just launched reads as a glitch.
  const [open, setOpen] = useState(false);
  const edit = (connection: DataConnection) => {
    setOpen(false);
    onEdit(connection);
  };

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      {/* Styled as a crumb, not a form control: it lives in the header trail
          next to the org switcher and has to read as the same species. */}
      <DropdownMenuTrigger className="inline-flex h-7 min-w-0 items-center gap-1.5 rounded-md px-2 text-sm font-medium text-foreground transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none data-popup-open:bg-accent">
        <span
          className={cn(
            "size-1.5 shrink-0 rounded-full",
            active === undefined
              ? "bg-muted-foreground/40"
              : active.healthy
                ? "bg-success"
                : "bg-warning",
          )}
        />
        <span className="max-w-[18ch] truncate">
          {isLoading ? "Loading…" : (active?.name ?? "No database")}
        </span>
        {active?.readOnly ? (
          <span className="shrink-0 rounded bg-muted px-1 py-0.5 font-mono text-[9.5px] tracking-wide text-muted-foreground uppercase">
            read-only
          </span>
        ) : null}
        <HugeiconsIcon
          icon={ArrowDown01Icon}
          strokeWidth={2}
          className="size-3.5 shrink-0 text-muted-foreground"
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-80">
        {options.managed.length > 0 ? (
          <DropdownMenuGroup>
            <DropdownMenuLabel className="text-[10px] tracking-wide uppercase">
              Managed by otterdeploy
            </DropdownMenuLabel>
            {options.managed.map((o) => (
              <TargetItem key={o.key} option={o} active={o.key === active?.key} onPick={onPick} />
            ))}
          </DropdownMenuGroup>
        ) : null}

        {options.external.length > 0 ? (
          <ExternalGroup
            options={options.external}
            activeKey={active?.key}
            onPick={onPick}
            onEdit={edit}
          />
        ) : null}

        {options.managed.length + options.external.length > 0 ? <DropdownMenuSeparator /> : null}

        {/* Plain foreground, not the accent: this is a menu action, and the
            accent is reserved for the primary action and current selection
            (DESIGN.md, The One Voice Rule). The icon carries the "action, not
            a place" distinction from the rows above. */}
        <DropdownMenuItem onClick={onConnect} className="gap-2">
          <HugeiconsIcon icon={PlusSignIcon} strokeWidth={2} className="size-3.5" />
          Connect a database URL…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The saved connections, narrowed by tag.
 *
 * The filter lives here, so it is born clear each time the menu mounts its
 * content and no "reset on close" bookkeeping is needed in the switcher.
 */
function ExternalGroup({
  options,
  activeKey,
  onPick,
  onEdit,
}: {
  options: WorkbenchTargetOption[];
  activeKey: string | undefined;
  onPick: (option: WorkbenchTargetOption) => void;
  onEdit: (connection: DataConnection) => void;
}) {
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const allTags = [...new Set(options.flatMap((o) => o.tags))].sort();
  const shown = tagFilter === null ? options : options.filter((o) => o.tags.includes(tagFilter));

  return (
    <DropdownMenuGroup>
      <DropdownMenuLabel className="text-[10px] tracking-wide uppercase">
        External connections
      </DropdownMenuLabel>
      {allTags.length > 0 ? (
        <TagStrip tags={allTags} selected={tagFilter} onSelect={setTagFilter} />
      ) : null}
      {shown.map((o) => (
        <TargetItem
          key={o.key}
          option={o}
          active={o.key === activeKey}
          onPick={onPick}
          onEdit={onEdit}
        />
      ))}
      {shown.length === 0 ? (
        <p className="px-2 py-1.5 text-[12px] text-muted-foreground">
          Nothing tagged <span className="font-mono">{tagFilter}</span>.
        </p>
      ) : null}
    </DropdownMenuGroup>
  );
}

function TargetItem({
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
function TagStrip({
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
