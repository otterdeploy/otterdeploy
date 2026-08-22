/**
 * The tooltip as a ranked answer.
 *
 * Grouped focus hands us every series at the hovered instant. Sorted largest
 * first — and totalled when the chart stacks — that turns a hover from "here
 * are some numbers" into "here is what is eating this box, in order". The
 * ordering is the information.
 *
 * Series whose value is null are dropped rather than shown as zero: null means
 * the sampler missed that tick, and reporting a missed sample as 0% is the same
 * fabrication as drawing a line across the gap.
 */

import type { ChartPoint } from "@tanstack/charts";

import type { LongRow } from "./series-rows";

const stamp = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

interface TooltipBodyProps {
  points: readonly ChartPoint<LongRow, Date, number>[];
  format: (value: number) => string;
  showTotal: boolean;
}

export function TooltipBody({ points, format, showTotal }: TooltipBodyProps) {
  const rows = points.filter((point) => point.yValue !== null && Number.isFinite(point.yValue));
  if (rows.length === 0) return null;

  const heading = rows[0].xValue;
  const total = rows.reduce((sum, point) => sum + point.yValue, 0);

  return (
    <div className="flex min-w-44 flex-col gap-1.5">
      <div className="font-mono text-[11px] text-muted-foreground">
        {heading instanceof Date ? stamp.format(heading) : String(heading)}
      </div>

      <div className="flex flex-col gap-1">
        {rows.map((point) => (
          <div key={point.key} className="flex items-center justify-between gap-4">
            <span className="flex min-w-0 items-center gap-1.5">
              <span
                aria-hidden="true"
                className="size-2 shrink-0 rounded-[2px]"
                style={{ background: point.color }}
              />
              <span className="truncate text-muted-foreground">{point.groupLabel}</span>
            </span>
            <span className="shrink-0 font-mono font-medium tabular-nums">
              {format(point.yValue)}
            </span>
          </div>
        ))}
      </div>

      {/* Only meaningful for a stack, where the parts genuinely sum to a whole.
          Totalling overlaid series would invent a number nothing measured. */}
      {showTotal && rows.length > 1 && (
        <div className="flex items-center justify-between gap-4 border-t border-border pt-1.5">
          <span className="text-muted-foreground">Total</span>
          <span className="font-mono font-medium tabular-nums">{format(total)}</span>
        </div>
      )}
    </div>
  );
}
