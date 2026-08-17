/**
 * Window control: the preset toggle plus a real custom range. Presets are the
 * common reads; the popover's from/to pair covers "that incident last
 * Tuesday" without leaving the page. The selection is owned by the URL (the
 * route passes it down), so a custom window is shareable.
 */

import { useState } from "react";

import { Button } from "@/shared/components/ui/button";
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

/** Local-time value for <input type="datetime-local"> (minute precision). */
function toLocalInput(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const stamp = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export function RangePicker({
  value,
  onChange,
}: {
  value: AnalyticsWindowSel;
  onChange: (next: AnalyticsWindowSel) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draftFrom, setDraftFrom] = useState(() =>
    toLocalInput(value.from ?? Date.now() - 24 * 60 * 60 * 1000),
  );
  const [draftTo, setDraftTo] = useState(() => toLocalInput(value.to ?? Date.now()));

  const fromMs = Date.parse(draftFrom);
  const toMs = Date.parse(draftTo);
  const draftValid = !Number.isNaN(fromMs) && !Number.isNaN(toMs) && fromMs < toMs;

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
            ? `${stamp.format(value.from)} – ${stamp.format(value.to)}`
            : "Custom"}
        </PopoverTrigger>
        <PopoverContent align="end" className="w-auto p-3">
          <div className="flex flex-col gap-2.5">
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              From
              <input
                type="datetime-local"
                value={draftFrom}
                max={draftTo}
                onChange={(e) => setDraftFrom(e.target.value)}
                className="rounded-md border bg-transparent px-2 py-1 font-mono text-xs text-foreground"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              To
              <input
                type="datetime-local"
                value={draftTo}
                min={draftFrom}
                onChange={(e) => setDraftTo(e.target.value)}
                className="rounded-md border bg-transparent px-2 py-1 font-mono text-xs text-foreground"
              />
            </label>
            <Button
              size="sm"
              disabled={!draftValid}
              onClick={() => {
                if (!draftValid) return;
                onChange({ range: "custom", from: fromMs, to: toMs });
                setOpen(false);
              }}
            >
              Apply
            </Button>
            {!draftValid ? (
              <p className="text-[11px] text-destructive">From must be before To.</p>
            ) : null}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
