/**
 * The filter command bar (⌘⇧F).
 *
 * ⌘K belongs to the app's own palette; this one sits next to the browser's
 * find, which is the reflex it competes with.
 *
 * One line of text for the whole filter set, for the operator who already knows
 * what they are looking for and does not want to click through four
 * disclosures. It writes the same filter values the sidebar writes, through the
 * same grammar the URL round-trips, so the two are never two systems.
 *
 * Completions come from the SERVER's facets, which means the suggestions are
 * values that exist in the current result set, with counts — not a static list
 * of everything the column could theoretically hold.
 */

import type { FilterSpec } from "@otterdeploy/shared/table-filters";

import { useEffect, useRef, useState } from "react";

import type { Facets } from "@/shared/components/data-table/feed/types";

import {
  parseQuery,
  partialToken,
  replaceWord,
  serializeQuery,
  wordAt,
} from "@/shared/components/data-table/state/grammar";
import { useFilterActions, useFilterValues } from "@/shared/components/data-table/state/store";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@/shared/components/ui/command";
import { Kbd } from "@/shared/components/ui/kbd";
import { cn } from "@/shared/lib/utils";

/** Filters the palette can express. A timerange reads better as a picker. */
function commandSpecs(specs: readonly FilterSpec[]): FilterSpec[] {
  return specs.filter((spec) => spec.type !== "timerange");
}

export function DataTableFilterCommand({
  specs,
  facets,
  open,
  onOpenChange,
}: {
  specs: readonly FilterSpec[];
  facets: Facets;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const values = useFilterValues();
  const { setValues } = useFilterActions();
  const usable = commandSpecs(specs);

  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState(() => serializeQuery(values, usable));
  const [caret, setCaret] = useState(0);

  // While the bar is closed it MIRRORS the filter state, so opening it always
  // shows what is actually applied. While it is open it leads, or the line
  // would rewrite itself under the cursor on every keystroke.
  const applied = serializeQuery(values, usable);
  const [lastApplied, setLastApplied] = useState(applied);
  if (!open && lastApplied !== applied) {
    setLastApplied(applied);
    setQuery(applied);
  }

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const commit = () => {
    // Every declared key is written, so a key REMOVED from the line clears its
    // filter rather than lingering because nothing mentioned it.
    const parsed = parseQuery(query, usable);
    const patch: Record<string, unknown> = {};
    for (const spec of usable) patch[spec.key] = parsed[spec.key];
    setValues(patch);
    setLastApplied(serializeQuery(parsed, usable));
    onOpenChange(false);
  };

  const word = wordAt(query, caret);
  const partial = partialToken(word);
  const activeSpec = partial ? usable.find((spec) => spec.key === partial.key) : undefined;

  const completions = activeSpec
    ? valueCompletions(activeSpec, facets, partial?.value ?? "")
    : keyCompletions(usable, word);

  const apply = (replacement: string) => {
    const next = replaceWord(query, caret, replacement);
    setQuery(next);
    // Put the caret at the end of what was just inserted, so the next keystroke
    // continues the token instead of landing in the middle of it.
    const position = next.indexOf(replacement) + replacement.length;
    requestAnimationFrame(() => {
      inputRef.current?.setSelectionRange(position, position);
      setCaret(position);
    });
  };

  if (!open) return null;

  return (
    <div className="border-b bg-background p-2">
      <Command
        // The line is the query; cmdk must not re-filter it as a search string.
        shouldFilter={false}
        className="overflow-visible rounded-lg p-0 ring-1 ring-foreground/10"
      >
        <div className="flex items-center gap-2 px-2">
          <span className="font-mono text-[11px] text-muted-foreground">filter</span>
          <input
            ref={inputRef}
            value={query}
            aria-label="Filter query"
            placeholder="outcome:denied action:project.delete"
            onChange={(event) => {
              setQuery(event.target.value);
              setCaret(event.target.selectionStart ?? event.target.value.length);
            }}
            onKeyUp={(event) => setCaret(event.currentTarget.selectionStart ?? 0)}
            onClick={(event) => setCaret(event.currentTarget.selectionStart ?? 0)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                commit();
              }
              if (event.key === "Escape") onOpenChange(false);
            }}
            className="h-9 flex-1 bg-transparent font-mono text-[13px] outline-none placeholder:text-muted-foreground/70"
          />
          <Kbd className="text-muted-foreground">↵</Kbd>
        </div>

        <div className="relative">
          <CommandList className="max-h-64 border-t">
            {/* The heading is a filter KEY, typed verbatim into the line above
                it, so it keeps its own casing: the group style's `uppercase`
                turned `resourceName` into `RESOURCENAME`, which is neither
                what the reader types nor a word. */}
            <CommandGroup
              heading={activeSpec ? activeSpec.key : "Filters"}
              className={
                activeSpec
                  ? "**:[[cmdk-group-heading]]:font-mono **:[[cmdk-group-heading]]:tracking-normal **:[[cmdk-group-heading]]:normal-case"
                  : undefined
              }
            >
              {completions.map((completion) => (
                <CommandItem
                  key={completion.insert}
                  value={completion.insert}
                  onSelect={() => apply(completion.insert)}
                  className="font-mono text-[12px]"
                >
                  {/* `flex-1` on the LABEL, and no `ml-auto` on the count.
                      CommandItem appends its checkmark with `ml-auto` after
                      these children, so a second `ml-auto` here left two auto
                      margins splitting the free space between them — the counts
                      landed at a different x on every row, tracking the label's
                      length. Letting the label take the slack puts every count
                      in one right-aligned column. Same trap, same fix, as
                      features/backups/database-combobox.tsx. */}
                  <span className="min-w-0 flex-1 truncate">{completion.label}</span>
                  {completion.hint === undefined ? null : (
                    <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
                      {completion.hint}
                    </span>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandEmpty>No matching filters.</CommandEmpty>
          </CommandList>

          <p className="flex flex-wrap gap-3 border-t px-2 py-1.5 text-[11px] text-muted-foreground">
            <span>
              Union <span className="font-mono">outcome:a,b</span>
            </span>
            <span>
              Range <span className="font-mono">latency:0-500</span>
            </span>
            <span>
              Spaces <span className="font-mono">reason:&quot;a b&quot;</span>
            </span>
          </p>
        </div>
      </Command>
    </div>
  );
}

interface Completion {
  /** The token that replaces the word under the caret. */
  insert: string;
  label: string;
  hint?: string;
}

function keyCompletions(specs: readonly FilterSpec[], word: string): Completion[] {
  const needle = word.toLowerCase();
  return specs
    .filter((spec) => needle === "" || spec.key.toLowerCase().includes(needle))
    .map((spec) => ({ insert: `${spec.key}:`, label: `${spec.key}:` }));
}

/**
 * Values the current result set actually contains, with their counts.
 *
 * Facets first, declared options second: a static option list can offer a value
 * that matches nothing, and the count is what tells the reader which of them is
 * worth choosing.
 */
function valueCompletions(spec: FilterSpec, facets: Facets, typed: string): Completion[] {
  const needle = typed.split(",").at(-1)?.toLowerCase() ?? "";
  const prefix = typed.includes(",") ? `${typed.slice(0, typed.lastIndexOf(",") + 1)}` : "";
  const facet = facets[spec.key];

  const rows = facet?.rows.map((row) => ({ value: String(row.value), total: row.total }));
  const options =
    rows ?? spec.options?.map((option) => ({ value: String(option), total: undefined })) ?? [];

  return options
    .filter((option) => needle === "" || option.value.toLowerCase().includes(needle))
    .slice(0, 20)
    .map((option) => ({
      insert: `${spec.key}:${prefix}${option.value}`,
      label: option.value,
      hint: option.total === undefined ? undefined : String(option.total),
    }));
}

/** The trigger that sits in the toolbar when the bar is closed. */
export function FilterCommandTrigger({
  onOpen,
  className,
}: {
  onOpen: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "flex h-8 items-center gap-1.5 rounded-lg px-2 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
        className,
      )}
    >
      Query
      <Kbd className="text-muted-foreground">⌘⇧F</Kbd>
    </button>
  );
}
