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
 */
import { Database02Icon, Globe02Icon, PlusSignIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Button } from "@/shared/components/ui/button";
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

import type { WorkbenchTargetOption } from "../data/use-workbench-targets";

export function TargetSwitcher({
  options,
  active,
  onPick,
  onConnect,
  isLoading,
}: {
  options: { managed: WorkbenchTargetOption[]; external: WorkbenchTargetOption[] };
  active: WorkbenchTargetOption | undefined;
  onPick: (option: WorkbenchTargetOption) => void;
  onConnect: () => void;
  isLoading: boolean;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            className="h-9 w-full max-w-none justify-start gap-2 px-2"
          >
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
            <span className="min-w-0 flex-1 truncate text-left font-medium">
              {isLoading ? "Loading…" : (active?.name ?? "No database")}
              {active ? (
                <span className="font-mono text-[10px] font-normal text-muted-foreground">
                  {` · ${active.engine}`}
                </span>
              ) : null}
            </span>
            {active?.readOnly ? (
              <span className="shrink-0 rounded bg-muted px-1 py-0.5 font-mono text-[9.5px] tracking-wide text-muted-foreground uppercase">
                read-only
              </span>
            ) : null}
            <span className="shrink-0 text-muted-foreground">⌄</span>
          </Button>
        }
      />
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
          <DropdownMenuGroup>
            <DropdownMenuLabel className="text-[10px] tracking-wide uppercase">
              External connections
            </DropdownMenuLabel>
            {options.external.map((o) => (
              <TargetItem key={o.key} option={o} active={o.key === active?.key} onPick={onPick} />
            ))}
          </DropdownMenuGroup>
        ) : null}

        {options.managed.length + options.external.length > 0 ? <DropdownMenuSeparator /> : null}

        <DropdownMenuItem onClick={onConnect} className="gap-2 text-primary">
          <HugeiconsIcon icon={PlusSignIcon} strokeWidth={2} className="size-3.5" />
          Connect a database URL…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function TargetItem({
  option,
  active,
  onPick,
}: {
  option: WorkbenchTargetOption;
  active: boolean;
  onPick: (option: WorkbenchTargetOption) => void;
}) {
  return (
    <DropdownMenuItem
      disabled={!option.healthy}
      onClick={() => {
        if (option.healthy) onPick(option);
      }}
      className={cn("gap-2", active && "bg-accent")}
    >
      <HugeiconsIcon
        icon={option.kind === "managed" ? Database02Icon : Globe02Icon}
        strokeWidth={2}
        className="size-3.5 shrink-0 text-muted-foreground"
      />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[13px] font-medium">{option.name}</span>
        <span className="truncate font-mono text-[10.5px] text-muted-foreground">
          {option.subtitle}
        </span>
      </span>
      {!option.healthy ? (
        <span className="shrink-0 font-mono text-[9.5px] tracking-wide text-warning uppercase">
          down
        </span>
      ) : null}
    </DropdownMenuItem>
  );
}
