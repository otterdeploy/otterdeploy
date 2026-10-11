/**
 * A deploy's clock, saying as much as it needs to: "14:18" today, "Sat 18:40"
 * within the week, "6 Oct, 23:30" before that (see `startedFormat`). The full
 * stamp sits in the tooltip.
 */

import { Temporal } from "@otterdeploy/shared/temporal";

import { CLOCK_DAY, CLOCK_EXACT, CLOCK_MINUTES, clockFormatter } from "@/shared/lib/clock";
import { cn } from "@/shared/lib/utils";

import { startedFormat } from "../model/deployments-view";

const FORMATS = {
  time: clockFormatter(CLOCK_MINUTES),
  "weekday-time": clockFormatter({ weekday: "short", ...CLOCK_MINUTES }),
  "date-time": clockFormatter({ ...CLOCK_DAY, ...CLOCK_MINUTES }),
} as const;
const exact = clockFormatter(CLOCK_EXACT);

const viewerZone = Temporal.Now.timeZoneId();

export function Clock({ iso, now, className }: { iso: string; now: number; className?: string }) {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return <span className="text-muted-foreground">–</span>;
  const format = startedFormat(iso, Temporal.Instant.fromEpochMilliseconds(now), viewerZone);
  return (
    <time
      dateTime={iso}
      title={exact(ms)}
      className={cn("font-mono text-[12.5px] whitespace-nowrap tabular-nums", className)}
    >
      {FORMATS[format](ms)}
    </time>
  );
}
