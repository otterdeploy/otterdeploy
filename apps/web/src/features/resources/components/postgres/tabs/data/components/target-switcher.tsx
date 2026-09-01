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

import { ArrowDown01Icon, PlugSocketIcon, PlusSignIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

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

import { TagStrip, TargetItem } from "./target-switcher-rows";

export function TargetSwitcher({
  options,
  active,
  onPick,
  onConnect,
  onEdit,
  onDisconnect,
  isLoading,
}: {
  options: { managed: WorkbenchTargetOption[]; external: WorkbenchTargetOption[] };
  active: WorkbenchTargetOption | undefined;
  onPick: (option: WorkbenchTargetOption) => void;
  onConnect: () => void;
  /** Open the saved connection's settings. Offered for the ACTIVE external target. */
  onEdit: (connection: DataConnection) => void;
  /** Close the open session and return to the picker. Present while one is open. */
  onDisconnect?: () => void;
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
        {onDisconnect !== undefined ? (
          <DropdownMenuItem onClick={onDisconnect} className="gap-2">
            <HugeiconsIcon icon={PlugSocketIcon} strokeWidth={2} className="size-3.5" />
            Disconnect
          </DropdownMenuItem>
        ) : null}
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
