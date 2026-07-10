/**
 * Searchable Docker-volume picker for the backup-now dialog. Mirrors the
 * DatabaseCombobox interaction; rows show the owning resource (or an "orphan"
 * tag — unclaimed volumes are still backupable) and the measured size.
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

import type { VolumeItem } from "./data/volumes";

import { fmtBytes } from "./shared";

function volumeTag(v: VolumeItem): string {
  const owner = v.attachedTo[0];
  if (owner) return owner.resourceName;
  return v.orphan ? "orphan" : "unclaimed";
}

export function VolumeCombobox({
  volumes,
  loading,
  value,
  onChange,
}: {
  volumes: VolumeItem[];
  loading: boolean;
  value: string;
  onChange: (volumeName: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = volumes.find((v) => v.name === value) ?? null;
  const empty = !loading && volumes.length === 0;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            disabled={empty}
            className={cn(
              "flex h-8 w-full items-center justify-between gap-1.5 rounded-lg border border-input bg-transparent py-2 pr-2 pl-2.5 text-sm whitespace-nowrap transition-colors outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30 dark:hover:bg-input/50",
            )}
          >
            {selected ? (
              <span className="flex min-w-0 items-center gap-2">
                <span className="truncate font-mono">{selected.name}</span>
                <Badge variant="secondary" className="shrink-0 font-normal">
                  {volumeTag(selected)}
                </Badge>
              </span>
            ) : (
              <span className="text-muted-foreground">
                {loading ? "Loading volumes…" : empty ? "No volumes found" : "Select a volume"}
              </span>
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
          <CommandInput placeholder="Search volumes or owners…" />
          <CommandList>
            <CommandEmpty>No matching volumes.</CommandEmpty>
            {volumes.map((v) => (
              <CommandItem
                key={v.name}
                // cmdk filters on this string — fold in the owner + project so
                // a user can narrow by any of them.
                value={`${v.name} ${v.attachedTo.map((a) => `${a.resourceName} ${a.projectSlug}`).join(" ")} ${v.orphan ? "orphan" : ""}`}
                data-checked={v.name === value ? "true" : undefined}
                onSelect={() => {
                  onChange(v.name);
                  setOpen(false);
                }}
                className="gap-2"
              >
                <span className="truncate font-mono text-[13px]">{v.name}</span>
                {v.sizeBytes >= 0 && (
                  <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                    {fmtBytes(v.sizeBytes)}
                  </span>
                )}
                <Badge variant="secondary" className="ml-auto shrink-0 font-normal">
                  {volumeTag(v)}
                </Badge>
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
