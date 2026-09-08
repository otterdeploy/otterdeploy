/**
 * What one bucket contains, on hover.
 *
 * The bar chart answers "when"; the tooltip answers "how many, of what". It
 * names the bucket's own span rather than an instant — a bar is a range, and
 * reporting its left edge as a timestamp invites the reader to believe the
 * count happened at that moment.
 *
 * Categories are ranked largest first and totalled, because a stack is a
 * part-to-whole and the ordering is the answer to "what is driving this spike".
 */

import type { ChartPoint } from "@tanstack/charts";

import { TooltipRow, TooltipTotal } from "@/shared/components/charts/tooltip-row";
import { CLOCK_STAMP, clockFormatter } from "@/shared/lib/clock";

const stamp = clockFormatter(CLOCK_STAMP);

/** One bar segment: a bucket, a category, and its count. */
export interface Segment {
  at: number;
  category: string;
  count: number;
}

export type SegmentPoint = ChartPoint<Segment, number, number>;

/** Descending by count. The ordering is the information. */
export function rankedByCount(a: SegmentPoint, b: SegmentPoint): number {
  return (b.yValue ?? Number.NEGATIVE_INFINITY) - (a.yValue ?? Number.NEGATIVE_INFINITY);
}

export function HistogramTooltip({
  points,
  bucketMs,
  /** True when the rows carry no category, so the legend row would say "rows". */
  uncategorized,
}: {
  points: readonly SegmentPoint[];
  bucketMs: number;
  uncategorized: boolean;
}) {
  const rows = points.filter((point) => Number.isFinite(point.yValue) && point.yValue > 0);
  if (rows.length === 0) return null;

  const at = rows[0]?.xValue;
  const total = rows.reduce((sum, point) => sum + point.yValue, 0);

  return (
    <div className="flex min-w-40 flex-col gap-1.5">
      {typeof at === "number" ? (
        <div className="font-mono text-xs text-muted-foreground">
          {stamp(at)} → {stamp(at + bucketMs)}
        </div>
      ) : null}

      {uncategorized ? null : (
        <div className="flex flex-col gap-1">
          {rows.map((point) => (
            <TooltipRow
              key={point.key}
              color={point.color}
              label={point.groupLabel}
              value={point.yValue.toLocaleString()}
            />
          ))}
        </div>
      )}

      <TooltipTotal label="Rows" value={total.toLocaleString()} />
    </div>
  );
}
