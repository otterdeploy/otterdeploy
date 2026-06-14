import { useState } from "react";
import { ArrowDown01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Button } from "@/shared/components/ui/button";
import { Checkbox } from "@/shared/components/ui/checkbox";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/shared/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/shared/components/ui/popover";

/**
 * Searchable, multi-select host filter for the edge access log. Empty
 * selection ⇒ all hosts. A flat single-line <Select> truncated long domains
 * with no way to find one among many; this is a Command popover (search +
 * checkbox rows), matching the design.
 */
export function HostFilter({
  options,
  value,
  onChange,
}: {
  options: string[];
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const [open, setOpen] = useState(false);

  const label =
    value.length === 0
      ? "All hosts"
      : value.length === 1
        ? value[0]
        : `${value.length} hosts`;

  const toggle = (host: string) =>
    onChange(
      value.includes(host)
        ? value.filter((h) => h !== host)
        : [...value, host],
    );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            className="h-8 w-[170px] justify-between gap-1.5 px-2.5 text-[12px] font-normal"
          >
            <span className="truncate">{label}</span>
            <HugeiconsIcon
              icon={ArrowDown01Icon}
              strokeWidth={2}
              className="size-3.5 shrink-0 text-muted-foreground"
            />
          </Button>
        }
      />
      <PopoverContent align="start" className="w-72 p-0">
        <Command>
          <CommandInput placeholder="Search hosts…" />
          <CommandList>
            <CommandEmpty>No hosts found.</CommandEmpty>
            <CommandItem
              value="__all_hosts__"
              onSelect={() => onChange([])}
              className="gap-2"
            >
              <Checkbox
                checked={value.length === 0}
                className="pointer-events-none"
              />
              <span>All hosts</span>
            </CommandItem>
            {options.map((host) => (
              <CommandItem
                key={host}
                value={host}
                onSelect={() => toggle(host)}
                className="gap-2 font-mono text-[12px]"
              >
                <Checkbox
                  checked={value.includes(host)}
                  className="pointer-events-none"
                />
                <span className="truncate">{host}</span>
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
