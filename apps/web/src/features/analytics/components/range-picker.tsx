/**
 * Window control: the preset toggle plus a real custom range. Presets are the
 * common reads; the popover's calendar covers "that incident last Tuesday"
 * without leaving the page. Custom windows are day-granular (start of the
 * first day to end of the last), and the selection is owned by the URL, so a
 * custom window is shareable.
 */

import { useState } from "react";

import { type DateRange } from "react-day-picker";

import { Button } from "@/shared/components/ui/button";
import { Calendar } from "@/shared/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/components/ui/popover";
import { ToggleGroup, ToggleGroupItem } from "@/shared/components/ui/toggle-group";

import type { AnalyticsRangeKey } from "../analytics-model";

import { ANALYTICS_RANGES } from "../analytics-model";

export interface AnalyticsWindowSel {
  range: AnalyticsRangeKey | "custom";
  /** Epoch ms; present only when range === "custom". */
  from?: number;
  to?: number;
}

function isPreset(value: string): value is AnalyticsRangeKey {
  return ANALYTICS_RANGES.some((range) => range === value);
}

const dayStamp = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });

function endOfDay(d: Date): number {
  const end = new Date(d);
  end.setHours(23, 59, 59, 999);
  // A range ending today must not reach into the future.
  return Math.min(end.getTime(), Date.now());
}

export function RangePicker({
  value,
  onChange,
}: {
  value: AnalyticsWindowSel;
  onChange: (next: AnalyticsWindowSel) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<DateRange | undefined>(() =>
    value.from !== undefined && value.to !== undefined
      ? { from: new Date(value.from), to: new Date(value.to) }
      : undefined,
  );

  const draftComplete = draft?.from !== undefined && draft.to !== undefined;

  return (
    <div className="flex items-center gap-2">
      <ToggleGroup
        value={value.range === "custom" ? [] : [value.range]}
        onValueChange={(next) => {
          const selected = next[0];
          if (selected !== undefined && isPreset(selected)) onChange({ range: selected });
        }}
        variant="outline"
        size="sm"
        spacing={0}
      >
        {ANALYTICS_RANGES.map((key) => (
          <ToggleGroupItem
            key={key}
            value={key}
            aria-label={`Last ${key}`}
            className="px-2.5 font-mono text-xs"
          >
            {key}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <Button
              variant="outline"
              size="sm"
              className="px-2.5 font-mono text-xs"
              data-state={value.range === "custom" ? "on" : "off"}
            />
          }
        >
          {value.range === "custom" && value.from !== undefined && value.to !== undefined
            ? `${dayStamp.format(value.from)} – ${dayStamp.format(value.to)}`
            : "Custom"}
        </PopoverTrigger>
        <PopoverContent align="end" className="w-auto p-2">
          <div className="flex flex-col gap-2">
            <Calendar
              mode="range"
              numberOfMonths={2}
              selected={draft}
              onSelect={setDraft}
              disabled={{ after: new Date() }}
              defaultMonth={draft?.from ?? new Date()}
            />
            <div className="flex items-center justify-between gap-2 px-1 pb-1">
              <span className="font-mono text-[11px] text-muted-foreground">
                {draftComplete && draft.from && draft.to
                  ? `${dayStamp.format(draft.from)} – ${dayStamp.format(draft.to)}`
                  : "Pick a start and end day."}
              </span>
              <Button
                size="sm"
                disabled={!draftComplete}
                onClick={() => {
                  if (!draft?.from || !draft.to) return;
                  const from = new Date(draft.from);
                  from.setHours(0, 0, 0, 0);
                  onChange({ range: "custom", from: from.getTime(), to: endOfDay(draft.to) });
                  setOpen(false);
                }}
              >
                Apply
              </Button>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
