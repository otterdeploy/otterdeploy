/**
 * Searchable database picker for the backups dialogs. A flat <Select> became
 * unusable once an org has many databases across projects. This is a Command
 * popover that filters by database name, engine, OR project as you type, with
 * the owning project shown as a tag on every row.
 */
import { useState } from "react";

import { UnfoldMoreIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Badge } from "@/shared/components/ui/badge";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/shared/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/components/ui/popover";
import { cn } from "@/shared/lib/utils";

/** The trigger's text before a database is picked. Exported for the tests. */
export function databasePlaceholder(loading: boolean, empty: boolean): string {
  if (loading) return "Loading databases…";
  return empty ? "No databases found" : "Select a database";
}

export interface DatabaseOption {
  resourceId: string;
  name: string;
  engine: string;
  projectName: string;
  projectSlug: string;
}

export function DatabaseCombobox({
  databases,
  loading = false,
  value,
  onChange,
}: {
  databases: DatabaseOption[];
  /** The source list has not answered yet. Until it does, "no databases" is
   *  not a fact: saying it while loading reads as an empty install, so the
   *  trigger says it is loading instead. */
  loading?: boolean;
  value: string;
  onChange: (resourceId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = databases.find((d) => d.resourceId === value) ?? null;
  const empty = !loading && databases.length === 0;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            disabled={empty || loading}
            aria-busy={loading || undefined}
            className={cn(
              "flex h-8 w-full items-center justify-between gap-1.5 rounded-lg border border-input bg-transparent py-2 pr-2 pl-2.5 text-sm whitespace-nowrap transition-colors outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30 dark:hover:bg-input/50",
            )}
          >
            {selected ? (
              <span className="flex min-w-0 items-center gap-2">
                <span className="truncate font-mono">{selected.name}</span>
                <Badge variant="secondary" className="shrink-0 font-normal">
                  {selected.projectName}
                </Badge>
              </span>
            ) : (
              <span className="text-muted-foreground">{databasePlaceholder(loading, empty)}</span>
            )}
            <HugeiconsIcon
              icon={UnfoldMoreIcon}
              strokeWidth={2}
              className="size-4 shrink-0 text-muted-foreground"
            />
          </button>
        }
      />
      <PopoverContent align="start" className="w-(--anchor-width) gap-0 p-0">
        <Command>
          <CommandInput placeholder="Search databases or projects…" />
          <CommandList>
            <CommandEmpty>No matching databases.</CommandEmpty>
            {databases.map((db) => (
              <CommandItem
                key={db.resourceId}
                // cmdk filters on this string, so fold in engine + project so a
                // user can narrow by any of them.
                value={`${db.name} ${db.engine} ${db.projectName} ${db.projectSlug} ${db.resourceId}`}
                data-checked={db.resourceId === value ? "true" : undefined}
                onSelect={() => {
                  onChange(db.resourceId);
                  setOpen(false);
                }}
                className="gap-2"
              >
                {/* `flex-1` and NOT `ml-auto` on the badge. CommandItem
                    appends its checkmark with `ml-auto` after these children,
                    so a second `ml-auto` here made TWO auto margins split the
                    free space between them — the badges landed at a different
                    x on every row, tracking name length. Letting the name take
                    the slack puts every badge in one column. */}
                <span className="min-w-0 flex-1 truncate font-mono text-[13px]">{db.name}</span>
                <Badge variant="secondary" className="shrink-0 font-normal">
                  {db.projectName}
                </Badge>
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
