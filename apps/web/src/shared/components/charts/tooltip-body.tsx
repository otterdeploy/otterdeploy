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

import { CLOCK_STAMP, clockFormatter } from "@/shared/lib/clock";

import type { LongRow } from "./series-rows";

import { TooltipRow, TooltipTotal } from "./tooltip-row";

const stamp = clockFormatter(CLOCK_STAMP);

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
      {/* The x value is a Date because d3's time scale speaks Date; `stamp`
          takes it across into Temporal. */}
      <div className="font-mono text-[11px] text-muted-foreground">
        {heading instanceof Date ? stamp(heading) : String(heading)}
      </div>

      <div className="flex flex-col gap-1">
        {rows.map((point) => (
          <TooltipRow
            key={point.key}
            color={point.color}
            label={point.groupLabel}
            value={format(point.yValue)}
          />
        ))}
      </div>

      {/* Only meaningful for a stack, where the parts genuinely sum to a whole.
          Totalling overlaid series would invent a number nothing measured. */}
      {showTotal && rows.length > 1 && <TooltipTotal label="Total" value={format(total)} />}
    </div>
  );
}
