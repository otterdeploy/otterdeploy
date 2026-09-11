/**
 * The time window.
 *
 * Presets first, because "the last hour" is what an operator actually asks, and
 * a calendar for the case where they know the window. A preset resolves to an
 * ABSOLUTE range the moment it is clicked, so the link that comes out of it
 * shows the same rows tomorrow — a URL that says "last hour" and means
 * something different every time it is opened is not a link to anything.
 *
 * That is also why choosing a window turns live tailing off: a fixed upper
 * bound and "keep showing me new rows" are contradictory instructions, and
 * silently keeping both is how a table looks stuck.
 */

import type { DateRange } from "react-day-picker";

import { useState } from "react";

import { Calendar03Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Temporal } from "@otterdeploy/shared/temporal";

import { useFilterActions, useFilterField } from "@/shared/components/data-table/state/store";
import { Button } from "@/shared/components/ui/button";
import { Calendar } from "@/shared/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/components/ui/popover";
import { CLOCK_DAY, CLOCK_STAMP, instantOf, LOG_ZONE, utcFormatter } from "@/shared/lib/clock";
import { cn } from "@/shared/lib/utils";

const stamp = utcFormatter(CLOCK_STAMP);
const dayStamp = utcFormatter(CLOCK_DAY);

/** Windows an operator reaches for, shortest first. */
const PRESETS = [
  { id: "15m", label: "15m", minutes: 15 },
  { id: "1h", label: "1h", minutes: 60 },
  { id: "6h", label: "6h", minutes: 360 },
  { id: "24h", label: "24h", minutes: 1440 },
  { id: "7d", label: "7d", minutes: 10_080 },
  { id: "30d", label: "30d", minutes: 43_200 },
] as const;

/**
 * A day boundary in {@link LOG_ZONE}.
 *
 * The same zone the rows print in, deliberately. Picking "Sep 8" in Berlin and
 * getting a window that starts at 22:00 on the 7th — because that is when the
 * local day began — would select rows the table labels as the previous day.
 */
function dayBounds(date: string, edge: "start" | "end"): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const zone = LOG_ZONE;
  const day = Temporal.PlainDate.from(date).toZonedDateTime(zone);
  const instant = edge === "start" ? day : day.add({ days: 1 }).subtract({ nanoseconds: 1 });
  return instant.toInstant().epochMilliseconds;
}

/**
 * A day the calendar handed back, as the `YYYY-MM-DD` {@link dayBounds} wants.
 *
 * react-day-picker deals in `Date` and nothing else, so this is the library
 * seam the repo's Temporal rule carves out: the value crosses into a
 * `Temporal.Instant` on the first line and no `Date` method is called on it.
 */
function calendarDay(date: Date): string {
  return instantOf(date).toZonedDateTimeISO(LOG_ZONE).toPlainDate().toString();
}

/** Epoch millis → the `Date` the calendar wants for its selection. */
function toCalendarDate(ms: number | undefined): Date | undefined {
  return ms === undefined ? undefined : new Date(ms);
}

function rangeOf(value: unknown): [number, number] | null {
  if (!Array.isArray(value)) return null;
  const [from, to] = value;
  return typeof from === "number" && typeof to === "number" ? [from, to] : null;
}

export function TimerangeFilter({ filterKey }: { filterKey: string }) {
  const { value, reset } = useFilterField(filterKey);
  const { setValues } = useFilterActions();
  const [open, setOpen] = useState(false);
  const range = rangeOf(value);

  const applyPreset = (minutes: number) => {
    const now = Temporal.Now.instant();
    setValues({
      [filterKey]: [now.subtract({ minutes }).epochMilliseconds, now.epochMilliseconds],
      // A window and a live tail contradict each other; the newer instruction
      // wins rather than both being half-applied.
      live: undefined,
    });
  };

  /**
   * A picked range commits only when BOTH ends exist.
   *
   * The calendar reports the first click as `{ from }` with no `to`, and
   * committing that would apply a window from that morning to itself — an empty
   * table one click into choosing a range.
   */
  const pickRange = (picked: DateRange | undefined) => {
    if (!picked?.from) return;
    const from = dayBounds(calendarDay(picked.from), "start");
    const to = dayBounds(calendarDay(picked.to ?? picked.from), "end");
    if (from === null || to === null) return;
    setValues({ [filterKey]: [from, to], live: undefined });
  };

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap gap-1">
        {PRESETS.map((preset) => (
          <Button
            key={preset.id}
            variant="outline"
            size="xs"
            onClick={() => applyPreset(preset.minutes)}
            className="h-6 px-2 font-mono text-[11px]"
          >
            {preset.label}
          </Button>
        ))}
        <Button
          variant="ghost"
          size="xs"
          onClick={reset}
          className={cn("h-6 px-2 text-[11px]", range ? undefined : "text-muted-foreground")}
        >
          All
        </Button>
      </div>

      {/*
       * One popover calendar, the same control the Edge access log uses.
       *
       * Two `input[type=date]` fields sat here before, and they were wrong twice
       * over. They were the browser's widget rather than ours — a `dd.mm.yyyy`
       * mask and a native calendar glyph in a panel where every other control is
       * a shadcn one — and a native date input has an intrinsic minimum width
       * (~135px in Chrome) that no `flex-1` can shrink, so the pair needed 285px
       * inside a 240px rail and hung out over its border.
       *
       * A popover has no such constraint: the trigger is as wide as the rail and
       * the calendar opens over the table.
       */}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <Button
              variant="outline"
              size="sm"
              className={cn(
                "h-7 w-full justify-start gap-1.5 px-2 text-[11px] font-normal",
                range ? "text-foreground" : "text-muted-foreground",
              )}
            >
              <HugeiconsIcon icon={Calendar03Icon} strokeWidth={2} className="size-3.5 shrink-0" />
              <span className="truncate font-mono">
                {range ? `${dayStamp(range[0])} – ${dayStamp(range[1])}` : "Pick dates"}
              </span>
            </Button>
          }
        />
        <PopoverContent align="start" className="w-auto p-0">
          <Calendar
            mode="range"
            numberOfMonths={1}
            selected={
              range ? { from: toCalendarDate(range[0]), to: toCalendarDate(range[1]) } : undefined
            }
            onSelect={pickRange}
            defaultMonth={toCalendarDate(range?.[0])}
          />
        </PopoverContent>
      </Popover>

      {range ? (
        // The exact window, spelled out. A preset that resolved an hour ago is
        // not "the last hour" any more, and the reader should be able to see so.
        <p className="px-1 font-mono text-[11px] break-words text-muted-foreground">
          {stamp(range[0])} → {stamp(range[1])}
        </p>
      ) : null}
    </div>
  );
}
