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

import { Temporal } from "@otterdeploy/shared/temporal";

import { useFilterActions, useFilterField } from "@/shared/components/data-table/state/store";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { CLOCK_STAMP, clockFormatter } from "@/shared/lib/clock";
import { cn } from "@/shared/lib/utils";

const stamp = clockFormatter(CLOCK_STAMP);

/** Windows an operator reaches for, shortest first. */
const PRESETS = [
  { id: "15m", label: "15m", minutes: 15 },
  { id: "1h", label: "1h", minutes: 60 },
  { id: "6h", label: "6h", minutes: 360 },
  { id: "24h", label: "24h", minutes: 1440 },
  { id: "7d", label: "7d", minutes: 10_080 },
  { id: "30d", label: "30d", minutes: 43_200 },
] as const;

/** A day boundary in the viewer's own zone — what a date input means to a person. */
function dayBounds(date: string, edge: "start" | "end"): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const zone = Temporal.Now.timeZoneId();
  const day = Temporal.PlainDate.from(date).toZonedDateTime(zone);
  const instant = edge === "start" ? day : day.add({ days: 1 }).subtract({ nanoseconds: 1 });
  return instant.toInstant().epochMilliseconds;
}

/** Epoch millis → the `YYYY-MM-DD` a date input wants, in the viewer's zone. */
function toDateInput(ms: number | undefined): string {
  if (ms === undefined) return "";
  return Temporal.Instant.fromEpochMilliseconds(ms)
    .toZonedDateTimeISO(Temporal.Now.timeZoneId())
    .toPlainDate()
    .toString();
}

function rangeOf(value: unknown): [number, number] | null {
  if (!Array.isArray(value)) return null;
  const [from, to] = value;
  return typeof from === "number" && typeof to === "number" ? [from, to] : null;
}

export function TimerangeFilter({ filterKey }: { filterKey: string }) {
  const { value, setValue, reset } = useFilterField(filterKey);
  const { setValues } = useFilterActions();
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

  const setEdge = (edge: "start" | "end", date: string) => {
    const bound = dayBounds(date, edge);
    if (bound === null) return;
    const current = range ?? [bound, Temporal.Now.instant().epochMilliseconds];
    setValue(edge === "start" ? [bound, current[1]] : [current[0], bound]);
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
            className="h-6 px-2 font-mono text-xs"
          >
            {preset.label}
          </Button>
        ))}
        <Button
          variant="ghost"
          size="xs"
          onClick={reset}
          className={cn("h-6 px-2 text-xs", range ? undefined : "text-muted-foreground")}
        >
          All
        </Button>
      </div>

      <div className="flex items-center gap-1.5">
        <Input
          type="date"
          aria-label="From date"
          value={toDateInput(range?.[0])}
          onChange={(event) => setEdge("start", event.target.value)}
          className="h-7 flex-1 font-mono text-xs"
        />
        <span className="text-xs text-muted-foreground">→</span>
        <Input
          type="date"
          aria-label="To date"
          value={toDateInput(range?.[1])}
          onChange={(event) => setEdge("end", event.target.value)}
          className="h-7 flex-1 font-mono text-xs"
        />
      </div>

      {range ? (
        // The exact window, spelled out. A preset that resolved an hour ago is
        // not "the last hour" any more, and the reader should be able to see so.
        <p className="px-1 font-mono text-xs text-muted-foreground">
          {stamp(range[0])} → {stamp(range[1])}
        </p>
      ) : null}
    </div>
  );
}
