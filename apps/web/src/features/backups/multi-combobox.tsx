/**
 * Generic multi-select combobox used across the backups dialogs — schedule
 * sources (databases) and the destination pickers. Searchable Command popover
 * with checkbox rows + a tag per row; selected entries render as removable
 * chips in the trigger. A value with no matching option still shows as a raw
 * chip so hand-entered / legacy refs aren't silently dropped.
 */
import { useState } from "react";

import { Cancel01Icon, UnfoldMoreIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Badge } from "@/shared/components/ui/badge";
import { Checkbox } from "@/shared/components/ui/checkbox";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/shared/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/components/ui/popover";
import { cn } from "@/shared/lib/utils";

export interface MultiOption {
  value: string;
  label: string;
  /** Muted secondary text shown after the label (e.g. owning project). */
  tag?: string;
  /** Extra text folded into the search index (engine, slug, uri…). */
  keywords?: string;
  /** Render the label in mono — db names, ids. */
  mono?: boolean;
}

export function MultiSelectCombobox({
  options,
  value,
  onChange,
  placeholder = "Select…",
  searchPlaceholder = "Search…",
  emptyText = "Nothing found.",
  disabled,
}: {
  options: MultiOption[];
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const byValue = new Map(options.map((o) => [o.value, o]));
  const selected = new Set(value);
  const toggle = (v: string) =>
    onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            disabled={disabled}
            className={cn(
              "flex min-h-8 w-full flex-wrap items-center gap-1 rounded-lg border border-input bg-transparent px-1.5 py-1 text-sm transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30 dark:hover:bg-input/50",
            )}
          >
            {value.length === 0 ? (
              <span className="px-1 text-muted-foreground">{placeholder}</span>
            ) : (
              value.map((v) => {
                const o = byValue.get(v);
                return (
                  <Badge key={v} variant="secondary" className="gap-1 py-0.5 font-normal">
                    <span className={o?.mono ? "font-mono" : undefined}>{o?.label ?? v}</span>
                    {o?.tag ? <span className="text-muted-foreground">· {o.tag}</span> : null}
                    <span
                      role="button"
                      tabIndex={-1}
                      aria-label={`Remove ${o?.label ?? v}`}
                      className="-mr-0.5 ml-0.5 rounded-sm opacity-60 hover:opacity-100"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggle(v);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          e.stopPropagation();
                          toggle(v);
                        }
                      }}
                    >
                      <HugeiconsIcon icon={Cancel01Icon} className="size-3" />
                    </span>
                  </Badge>
                );
              })
            )}
            <HugeiconsIcon
              icon={UnfoldMoreIcon}
              strokeWidth={2}
              className="ml-auto size-4 shrink-0 self-center text-muted-foreground"
            />
          </button>
        }
      />
      <PopoverContent align="start" className="w-(--anchor-width) gap-0 p-0">
        <Command>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            {options.map((o) => (
              <CommandItem
                key={o.value}
                value={`${o.label} ${o.tag ?? ""} ${o.keywords ?? ""} ${o.value}`}
                onSelect={() => toggle(o.value)}
                className="gap-2"
              >
                <Checkbox checked={selected.has(o.value)} className="pointer-events-none" />
                <span className={cn("truncate text-[13px]", o.mono && "font-mono")}>{o.label}</span>
                {o.tag ? (
                  <Badge variant="secondary" className="ml-auto shrink-0 font-normal">
                    {o.tag}
                  </Badge>
                ) : null}
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
