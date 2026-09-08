/**
 * The filter sidebar.
 *
 * One disclosure per filterable column, in schema order, each holding the
 * control its declared type calls for. A section that is filtered shows how
 * many values it is filtering on, so a collapsed sidebar still says where the
 * narrowing is coming from — the failure mode of every filter drawer is a
 * result set nobody can explain.
 */

import type { RowData } from "@tanstack/react-table";

import { ArrowDown01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import type { Facets } from "@/shared/components/data-table/feed/types";
import type { DataTableColumn } from "@/shared/components/data-table/schema/types";

import {
  CheckboxFilter,
  InputFilter,
  RangeFilter,
} from "@/shared/components/data-table/parts/filter-controls";
import { TimerangeFilter } from "@/shared/components/data-table/parts/filter-timerange";
import { useFilterField } from "@/shared/components/data-table/state/store";
import { Button } from "@/shared/components/ui/button";
import {
  Collapsible,
  CollapsiblePanel,
  CollapsibleTrigger,
} from "@/shared/components/ui/collapsible";
import { cn } from "@/shared/lib/utils";

/** How many values one filter is narrowing on, for the section's own badge. */
function activeCount(value: unknown): number {
  if (value === null || value === undefined || value === "") return 0;
  if (Array.isArray(value)) return value.length === 0 ? 0 : 1;
  return 1;
}

function FilterSection<TRow extends RowData>({
  column,
  facets,
}: {
  column: DataTableColumn<TRow>;
  facets: Facets;
}) {
  const declared = column.filter;
  const { value, reset } = useFilterField(column.key);
  if (!declared) return null;

  const count = activeCount(value);
  const facet = facets[column.key];

  return (
    <Collapsible defaultOpen={declared.defaultOpen ?? count > 0} className="border-b">
      <CollapsibleTrigger
        render={
          <button
            type="button"
            className="group flex w-full items-center gap-2 px-2 py-2.5 text-left transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          />
        }
      >
        <span className="text-[13px] font-medium">{column.label}</span>
        {count > 0 ? (
          <span className="rounded-full bg-primary/10 px-1.5 font-mono text-[10px] text-primary">
            on
          </span>
        ) : null}
        <HugeiconsIcon
          icon={ArrowDown01Icon}
          strokeWidth={2}
          className="ml-auto size-3.5 shrink-0 text-muted-foreground transition-transform group-data-panel-open:rotate-180"
        />
      </CollapsibleTrigger>
      <CollapsiblePanel>
        <div className="px-1 pt-0.5 pb-3">
          {declared.type === "checkbox" ? (
            <CheckboxFilter filterKey={column.key} declared={declared} facet={facet} />
          ) : null}
          {declared.type === "input" ? (
            <InputFilter filterKey={column.key} label={column.label} />
          ) : null}
          {declared.type === "slider" ? (
            <RangeFilter filterKey={column.key} declared={declared} facet={facet} />
          ) : null}
          {declared.type === "timerange" ? <TimerangeFilter filterKey={column.key} /> : null}
          {count > 0 ? (
            <Button
              variant="ghost"
              size="xs"
              onClick={reset}
              className="mt-1.5 h-6 px-1.5 text-[11px] text-muted-foreground"
            >
              Clear
            </Button>
          ) : null}
        </div>
      </CollapsiblePanel>
    </Collapsible>
  );
}

export function DataTableFilterPanel<TRow extends RowData>({
  columns,
  facets,
  className,
}: {
  columns: readonly DataTableColumn<TRow>[];
  facets: Facets;
  className?: string;
}) {
  // A `search` spans several columns and belongs in the toolbar, where a search
  // box is looked for — not in a section named after a column it is not.
  const sections = columns.filter((column) => column.filter && column.filter.type !== "search");
  if (sections.length === 0) return null;

  return (
    <div className={cn("flex flex-col", className)}>
      {sections.map((column) => (
        <FilterSection key={column.key} column={column} facets={facets} />
      ))}
    </div>
  );
}
