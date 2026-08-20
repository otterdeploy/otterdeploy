import { useState } from "react";

import { Calendar03Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { type DateRange } from "react-day-picker";

import { Button } from "@/shared/components/ui/button";
import { Calendar } from "@/shared/components/ui/calendar";
import { Input } from "@/shared/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/components/ui/popover";
import { cn } from "@/shared/lib/utils";

import { RANGES, type Range, Segmented } from "./edge-logs-shared";

/** The access-log time window: a rolling preset ending "now", or a fixed
 *  custom [from, to] pair (epoch ms). */
export type TimeWindow = { preset: Range } | { from: number; to: number };

export function isPresetWindow(w: TimeWindow): w is { preset: Range } {
  return "preset" in w;
}

const isRange = (v: string): v is Range => RANGES.some((r) => r === v);

/** Edge-log retention: the server keeps 7 days, so older dates can only
 *  return empty results. */
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

function fmtShort(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Histogram axis labels for a window: start on the left, end on the right. */
export function windowLabels(w: TimeWindow): { start: string; end: string } {
  if (isPresetWindow(w)) return { start: `−${w.preset}`, end: "now" };
  return { start: fmtShort(w.from), end: fmtShort(w.to) };
}

/** The edgeLogs.query input fragment a window maps to. */
export function windowQueryInput(w: TimeWindow): { range: Range } | { from: number; to: number } {
  return isPresetWindow(w) ? { range: w.preset } : { from: w.from, to: w.to };
}

/** `HH:MM` from an epoch ms, for seeding the time inputs. */
function toTimeInput(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** Local-midnight day + `HH:MM` → epoch ms. Falls back to midnight on an
 *  unparsable time (the input is type="time", so that's belt-and-braces). */
function combine(day: Date, time: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time);
  const d = new Date(day);
  d.setHours(m ? Number(m[1]) : 0, m ? Number(m[2]) : 0, 0, 0);
  return d.getTime();
}

/**
 * Time window control for the edge access log: the preset segmented row
 * (5m…7d) plus a calendar popover for an arbitrary from–to window within the
 * 7-day retention. Picking a preset clears the custom window and vice versa.
 */
export function TimeRangePicker({
  value,
  onChange,
}: {
  value: TimeWindow;
  onChange: (next: TimeWindow) => void;
}) {
  const [open, setOpen] = useState(false);
  const custom = isPresetWindow(value) ? null : value;

  // Draft state lives here (not committed) until Apply, so half-picked ranges
  // never fire queries.
  const [days, setDays] = useState<DateRange | undefined>();
  const [fromTime, setFromTime] = useState("00:00");
  const [toTime, setToTime] = useState("23:59");
  // Selectable bounds (retention window), captured when the popover opens:
  // "now" is impure, so it can't be read during render.
  const [bounds, setBounds] = useState<{ min: Date; max: Date } | null>(null);

  const openWith = (next: boolean) => {
    if (next) {
      const now = Date.now();
      setBounds({ min: new Date(now - RETENTION_MS), max: new Date(now) });
      // Seed the draft from the committed window each time it opens.
      if (custom) {
        setDays({ from: new Date(custom.from), to: new Date(custom.to) });
        setFromTime(toTimeInput(custom.from));
        setToTime(toTimeInput(custom.to));
      } else {
        setDays(undefined);
        setFromTime("00:00");
        setToTime("23:59");
      }
    }
    setOpen(next);
  };

  const apply = () => {
    if (!days?.from) return;
    const from = combine(days.from, fromTime);
    // A single clicked day is a one-day window.
    const to = Math.min(combine(days.to ?? days.from, toTime), Date.now());
    if (from >= to) return;
    onChange({ from, to });
    setOpen(false);
  };

  return (
    <div className="flex items-center gap-1">
      <Segmented
        options={RANGES}
        value={isPresetWindow(value) ? value.preset : null}
        onChange={(v) => {
          if (isRange(v)) onChange({ preset: v });
        }}
      />
      <Popover open={open} onOpenChange={openWith}>
        <PopoverTrigger
          render={
            <Button
              variant="outline"
              size="sm"
              className={cn(
                "h-8 gap-1.5 px-2.5 text-[11px] font-medium",
                custom ? "bg-muted text-foreground" : "text-muted-foreground",
              )}
              title="Custom time range (within the 7-day log retention)"
            >
              <HugeiconsIcon icon={Calendar03Icon} strokeWidth={2} className="size-3.5" />
              {custom ? `${fmtShort(custom.from)} – ${fmtShort(custom.to)}` : "Custom"}
            </Button>
          }
        />
        <PopoverContent align="start" className="w-auto p-0">
          <Calendar
            mode="range"
            numberOfMonths={1}
            selected={days}
            onSelect={setDays}
            disabled={bounds ? { before: bounds.min, after: bounds.max } : undefined}
            defaultMonth={days?.from ?? bounds?.max}
          />
          <div className="flex items-center gap-2 border-t p-2">
            <Input
              type="time"
              value={fromTime}
              onChange={(e) => setFromTime(e.target.value)}
              className="h-8 w-fit text-[12px]"
              aria-label="Start time"
            />
            <span className="text-[11px] text-muted-foreground">to</span>
            <Input
              type="time"
              value={toTime}
              onChange={(e) => setToTime(e.target.value)}
              className="h-8 w-fit text-[12px]"
              aria-label="End time"
            />
            <div className="flex-1" />
            {custom ? (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 text-[12px]"
                onClick={() => {
                  onChange({ preset: "1h" });
                  setOpen(false);
                }}
              >
                Clear
              </Button>
            ) : null}
            <Button size="sm" className="h-8 text-[12px]" disabled={!days?.from} onClick={apply}>
              Apply
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
