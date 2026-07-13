/**
 * "Filter Data" popover — anchored to the Filter button. Layout matches the
 * reference: header · natural-language hint · filter rows · footer
 * (Add Filter | Cancel · Apply). Edits a DRAFT (Cancel discards), commits on
 * Apply. Reuses ./filter-bar (rows) and ./filters (server-side WHERE compiler).
 *
 * NOTE: the NL hint input is rendered to match the design; parsing free-text
 * into filters is a later enhancement — the structured rows below are the
 * functional path today.
 */

import { useState } from "react";

import { FilterIcon, PlusSignIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Button } from "@/shared/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/components/ui/popover";

import { type Filter, isFilterActive, newFilter } from "../data/filters";
import { FilterBar } from "./filter-bar";

export function FilterPopover({
  columns,
  filters,
  onApply,
  trigger,
}: {
  columns: string[];
  filters: Filter[];
  onApply: (next: Filter[]) => void;
  trigger: React.ReactElement;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Filter[]>(filters);

  // Re-seed the draft when the popover opens — done in the open handler (not an
  // effect) so the rows are correct on the first paint and we skip an extra render.
  function handleOpenChange(next: boolean) {
    if (next) setDraft(filters.length ? filters : [newFilter()]);
    setOpen(next);
  }

  function apply() {
    onApply(draft.filter(isFilterActive));
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger render={trigger} />
      <PopoverContent align="start" className="w-115 max-w-[92vw] gap-0 p-0">
        {/* Header */}
        <div className="flex items-center gap-2 border-b px-3 py-2.5 text-[13px] font-medium">
          <HugeiconsIcon
            icon={FilterIcon}
            strokeWidth={2}
            className="size-4 text-muted-foreground"
          />
          Filter Data
        </div>

        {/* Natural-language hint (decorative for now) */}
        <div className="border-b px-3 py-2.5">
          <span>{"e.g. status = active and revenue > 100"}</span>
        </div>

        {/* Filter rows */}
        <FilterBar columns={columns} filters={draft} onChange={setDraft} />

        {/* Footer */}
        <div className="flex items-center justify-between gap-2 px-3 py-2.5">
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => setDraft((d) => [...d, newFilter()])}
          >
            <HugeiconsIcon icon={PlusSignIcon} strokeWidth={2} className="size-3.5" />
            Add Filter
          </Button>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={apply}>
              Apply
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
