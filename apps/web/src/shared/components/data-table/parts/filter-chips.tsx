/**
 * What is currently narrowing the table, said out loud.
 *
 * The sidebar can be collapsed and is hidden outright on a small screen, so
 * without this the only evidence of a filter is a number on a button — and "why
 * am I only seeing 12 rows" is the question a filter UI exists to answer. Each
 * chip names its filter and its values and removes exactly that one.
 *
 * The row is rendered only when something is active: an empty strip that
 * appears and disappears would move the table's first row on every filter
 * change, which is movement the reader did not ask for.
 */

import type { FilterSpec } from "@otterdeploy/shared/table-filters";

import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { isActive } from "@otterdeploy/shared/table-filters";

import { useFilterActions, useFilterValues } from "@/shared/components/data-table/state/store";
import { CLOCK_STAMP, clockFormatter } from "@/shared/lib/clock";

const stamp = clockFormatter(CLOCK_STAMP);

/** Beyond this many members a chip names the count instead of the values. */
const MAX_MEMBERS = 3;

function membersLabel(value: readonly unknown[]): string {
  const members = value.map((member) => String(member));
  if (members.length <= MAX_MEMBERS) return members.join(", ");
  return `${members.slice(0, MAX_MEMBERS).join(", ")} +${members.length - MAX_MEMBERS}`;
}

/** A window with no upper bound reads as "after", not as a range with a hole. */
function windowLabel(value: unknown): string | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const from = Number(value[0]);
  if (!Number.isFinite(from)) return null;
  const to = value.length > 1 ? Number(value[1]) : Number.NaN;
  return Number.isFinite(to) ? `${stamp(from)} → ${stamp(to)}` : `after ${stamp(from)}`;
}

/**
 * One filter's value, as a person would say it.
 *
 * Deliberately not the query grammar: `at:1764547200000-1764633600000` is a
 * round-trippable token and an unreadable chip.
 */
function chipLabel(spec: FilterSpec, value: unknown): string | null {
  if (!isActive(value)) return null;
  switch (spec.type) {
    case "checkbox":
      return Array.isArray(value) ? membersLabel(value) : String(value);
    case "slider": {
      if (!Array.isArray(value) || value.length !== 2) return null;
      return `${String(value[0])} – ${String(value[1])}`;
    }
    case "timerange":
      return windowLabel(value);
    case "input":
    case "search":
      return typeof value === "string" ? `"${value}"` : null;
  }
}

export function DataTableFilterChips({ specs }: { specs: readonly FilterSpec[] }) {
  const values = useFilterValues();
  const { resetValue, resetAll } = useFilterActions();

  const chips = specs
    .map((spec) => ({ spec, label: chipLabel(spec, values[spec.key]) }))
    .filter((chip): chip is { spec: FilterSpec; label: string } => chip.label !== null);

  if (chips.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b px-3 py-1.5">
      {chips.map(({ spec, label }) => (
        <span
          key={spec.key}
          className="flex max-w-full items-center gap-1 rounded-full bg-muted py-0.5 pr-0.5 pl-2 text-xs ring-1 ring-foreground/10"
        >
          <span className="shrink-0 text-muted-foreground">{spec.key}</span>
          <span className="truncate font-mono">{label}</span>
          <button
            type="button"
            aria-label={`Clear the ${spec.key} filter`}
            onClick={() => resetValue(spec.key)}
            className="flex size-4 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} className="size-2.5" />
          </button>
        </span>
      ))}

      {chips.length > 1 ? (
        <button
          type="button"
          onClick={resetAll}
          className="rounded-sm px-1 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          Clear all
        </button>
      ) : null}
    </div>
  );
}
