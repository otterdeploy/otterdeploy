import { useState } from "react";

import { ArrowDown01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useTranslation } from "react-i18next";

import { Button } from "@/shared/components/ui/button";
import { Checkbox } from "@/shared/components/ui/checkbox";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/shared/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/components/ui/popover";

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
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  const label =
    value.length === 0 ? "All hosts" : value.length === 1 ? value[0] : `${value.length} hosts`;

  const toggle = (host: string) =>
    onChange(value.includes(host) ? value.filter((h) => h !== host) : [...value, host]);

  const selected = new Set(value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            className="h-8 w-[210px] justify-between gap-1.5 px-2.5 text-[12px] font-normal"
            // Deployment hostnames share a long prefix, so a truncated trigger
            // can read identically for two different selections — the full
            // value has to be recoverable without reopening the popover.
            title={value.length ? value.join("\n") : "All hosts"}
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
      {/* Wide enough for a real `<service>-pr-N-<project>.<ip>.sslip.io`, and
          capped so it can't outgrow a narrow window. */}
      <PopoverContent align="start" className="w-[min(30rem,calc(100vw-2rem))] p-0">
        <Command>
          <CommandInput placeholder={t("edgeLogs.searchHosts")} />
          <CommandList>
            <CommandEmpty>{t("edgeLogs.noHosts")}</CommandEmpty>
            <CommandItem value="__all_hosts__" onSelect={() => onChange([])} className="gap-2">
              <Checkbox checked={value.length === 0} className="pointer-events-none" />
              <span>{t("edgeLogs.allHosts")}</span>
            </CommandItem>
            {options.map((host) => (
              <CommandItem
                key={host}
                value={host}
                onSelect={() => toggle(host)}
                className="items-start gap-2 font-mono text-[12px]"
                title={host}
              >
                <Checkbox
                  checked={selected.has(host)}
                  className="pointer-events-none mt-0.5 shrink-0"
                />
                {/* Wraps rather than truncates: these hostnames differ in the
                    middle (pr-1 vs pr-2) and at the end, so clipping either end
                    can leave two options looking the same. */}
                <span className="min-w-0 break-all">{host}</span>
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
