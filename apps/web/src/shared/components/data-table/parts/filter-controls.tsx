/**
 * The four filter controls.
 *
 * Each reads and writes ONE key in the filter store, so a checkbox click
 * re-renders that control and the rows — not the toolbar, not the chart, not
 * the other filters. Every control is also the same value the URL carries and
 * the server compiles, so there is nothing to keep in sync.
 */

import type { Scalar } from "@otterdeploy/shared/table-filters";

import { useEffect, useState } from "react";

import { Search01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { formatNumber } from "@otterdeploy/shared/format";

import type { Facet } from "@/shared/components/data-table/feed/types";
import type { FilterDeclaration } from "@/shared/components/data-table/schema/types";

import { useFilterField } from "@/shared/components/data-table/state/store";
import { Checkbox } from "@/shared/components/ui/checkbox";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { cn } from "@/shared/lib/utils";

/** Values already chosen for a multi-select, whatever shape the URL delivered. */
function selectedValues(value: unknown): Scalar[] {
  if (Array.isArray(value)) {
    return value.filter(
      (item): item is Scalar =>
        typeof item === "string" || typeof item === "number" || typeof item === "boolean",
    );
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return [value];
  }
  return [];
}

const sameValue = (a: Scalar, b: Scalar) => String(a) === String(b);

/**
 * Multi-select with counts.
 *
 * Options come from the declaration when it has them and from the server's
 * facets when it does not — so a column whose values are open-ended (an actor,
 * an action name) still gets a real list rather than a text box.
 *
 * The counts are the point: "denied 12" answers the question before the click,
 * and an option at zero is visibly a dead end rather than a promising one.
 */
export function CheckboxFilter({
  filterKey,
  declared,
  facet,
}: {
  filterKey: string;
  declared: FilterDeclaration;
  facet?: Facet;
}) {
  const { value, setValue } = useFilterField(filterKey);
  const [query, setQuery] = useState("");
  const selected = selectedValues(value);

  const options =
    declared.options ??
    facet?.rows.map((row) => ({ label: String(row.value), value: row.value })) ??
    [];
  const counts = new Map(facet?.rows.map((row) => [String(row.value), row.total]));

  const visible = options.filter(
    (option) => query === "" || option.label.toLowerCase().includes(query.toLowerCase()),
  );

  const toggle = (option: Scalar, checked: boolean) => {
    const next = checked
      ? [...selected, option]
      : selected.filter((item) => !sameValue(item, option));
    setValue(next.length > 0 ? next : undefined);
  };

  if (options.length === 0) {
    return <p className="px-1 py-2 text-xs text-muted-foreground">No values in range.</p>;
  }

  return (
    <div className="grid gap-2">
      {options.length > 6 ? (
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search values"
          className="h-7 text-xs"
          aria-label={`Search ${filterKey} values`}
        />
      ) : null}
      <div className="max-h-56 overflow-y-auto rounded-md ring-1 ring-foreground/10">
        {visible.map((option, index) => {
          const isChecked = selected.some((item) => sameValue(item, option.value));
          const count = counts.get(String(option.value));
          const id = `${filterKey}-${String(option.value)}`;
          return (
            <div
              key={id}
              className={cn(
                "group flex items-center gap-2 px-2 py-1.5 transition-colors hover:bg-muted/50",
                index === visible.length - 1 ? undefined : "border-b",
              )}
            >
              <Checkbox
                id={id}
                checked={isChecked}
                onCheckedChange={(checked) => toggle(option.value, checked === true)}
              />
              <Label htmlFor={id} className="flex min-w-0 flex-1 items-center gap-2 text-xs">
                <span className="truncate font-normal">{option.label}</span>
                <span className="ml-auto shrink-0 font-mono text-[11px] text-muted-foreground tabular-nums">
                  {count === undefined ? null : formatNumber(count)}
                </span>
              </Label>
              {/* "Only" is the move an operator actually wants after reading a
                  count, and doing it by hand means unticking everything else. */}
              <button
                type="button"
                onClick={() => setValue([option.value])}
                className="hidden shrink-0 rounded px-1 text-[11px] text-muted-foreground group-hover:block hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                only
              </button>
            </div>
          );
        })}
        {visible.length === 0 ? (
          <p className="px-2 py-2 text-xs text-muted-foreground">No matching values.</p>
        ) : null}
      </div>
    </div>
  );
}

/**
 * A text box, debounced.
 *
 * The debounce is what keeps typing from becoming one request and one history
 * entry per keystroke. The local value leads and the store follows; when the
 * store changes from elsewhere (a cleared filter, a pasted link) the local
 * value is re-seeded from it.
 */
export function InputFilter({ filterKey, label }: { filterKey: string; label: string }) {
  const { value, setValue } = useFilterField(filterKey);
  const committed = typeof value === "string" ? value : "";
  const [draft, setDraft] = useState(committed);
  const [lastCommitted, setLastCommitted] = useState(committed);

  // Re-seeded during render, not from an effect: the store can change from
  // elsewhere (a cleared filter, a pasted link), and an effect would paint one
  // frame of the stale text first.
  if (lastCommitted !== committed) {
    setLastCommitted(committed);
    setDraft(committed);
  }

  useEffect(() => {
    if (draft === committed) return;
    const timer = setTimeout(() => setValue(draft.trim() === "" ? undefined : draft), 350);
    return () => clearTimeout(timer);
  }, [draft, committed, setValue]);

  return (
    <div className="relative">
      <HugeiconsIcon
        icon={Search01Icon}
        strokeWidth={2}
        className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground"
      />
      <Input
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        placeholder={`Filter ${label.toLowerCase()}`}
        aria-label={`Filter by ${label}`}
        className="h-8 pl-7 text-xs"
      />
    </div>
  );
}

/**
 * A numeric range as two boxes.
 *
 * Two boxes rather than a drag handle: an operator filtering latency knows the
 * number they care about ("over 500ms"), and a slider makes them hunt for it.
 * The declared bounds seed the placeholders so the range is legible before it
 * is touched.
 */
export function RangeFilter({
  filterKey,
  declared,
  facet,
}: {
  filterKey: string;
  declared: FilterDeclaration;
  facet?: Facet;
}) {
  const { value, setValue } = useFilterField(filterKey);
  const bounds: [number, number] = [
    facet?.min ?? declared.min ?? 0,
    facet?.max ?? declared.max ?? 100,
  ];
  const current = Array.isArray(value) ? value : [];
  const low = typeof current[0] === "number" ? current[0] : undefined;
  const high = typeof current[1] === "number" ? current[1] : undefined;

  const commit = (nextLow: number | undefined, nextHigh: number | undefined) => {
    if (nextLow === undefined && nextHigh === undefined) return setValue(undefined);
    setValue([nextLow ?? bounds[0], nextHigh ?? bounds[1]]);
  };

  return (
    <div className="flex items-center gap-2">
      <Input
        type="number"
        inputMode="numeric"
        aria-label={`Minimum ${filterKey}`}
        placeholder={String(bounds[0])}
        value={low ?? ""}
        onChange={(event) =>
          commit(event.target.value === "" ? undefined : Number(event.target.value), high)
        }
        className="h-8 font-mono text-xs"
      />
      <span className="text-xs text-muted-foreground">to</span>
      <Input
        type="number"
        inputMode="numeric"
        aria-label={`Maximum ${filterKey}`}
        placeholder={String(bounds[1])}
        value={high ?? ""}
        onChange={(event) =>
          commit(low, event.target.value === "" ? undefined : Number(event.target.value))
        }
        className="h-8 font-mono text-xs"
      />
    </div>
  );
}
