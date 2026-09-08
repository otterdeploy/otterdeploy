/**
 * The time histogram above the table.
 *
 * It answers the question an operator asks before any other — *when did this
 * happen, and was it always like this* — and it answers it about EXACTLY the
 * rows in the table, because the buckets are computed from the same filtered
 * set the feed queried.
 *
 * Two decisions worth naming:
 *
 * - **A drag parks a selection; it does not apply one.** Releasing the mouse
 *   shows the window and a Zoom button rather than re-querying, so a stray drag
 *   across the chart costs nothing. Confirm with Zoom or Enter, discard with
 *   Cancel or Escape.
 * - **Empty buckets are drawn.** A gap is information — "nothing happened
 *   here" — and a series that silently skips it draws a continuous run of
 *   activity that never existed.
 */

import { useEffect, useMemo, useState } from "react";

import { barY, defineChart } from "@tanstack/charts";
import { brushX, type BrushRange, type BrushXChange } from "@tanstack/charts/interaction/brush";
import { controlledSignal } from "@tanstack/charts/interaction/signal";
import { Chart } from "@tanstack/charts/react";
import { scaleBand } from "@tanstack/charts/scales/band";
import { scaleLinear } from "@tanstack/charts/scales/linear";
import { scaleOrdinal } from "@tanstack/charts/scales/ordinal";

import type { FeedHistogram } from "@/shared/components/data-table/feed/types";

import { Button } from "@/shared/components/ui/button";
import { CLOCK_MINUTES, CLOCK_STAMP, clockFormatter } from "@/shared/lib/clock";
import { cn } from "@/shared/lib/utils";

const tick = clockFormatter(CLOCK_MINUTES);
const stamp = clockFormatter(CLOCK_STAMP);

/** One bar segment: a bucket, a category, and its count. */
interface Segment {
  at: number;
  category: string;
  count: number;
}

const UNCATEGORIZED = "rows";

/** A stable empty array, so "no data yet" does not change identity per render. */
const NO_BUCKETS: FeedHistogram["buckets"] = [];

/**
 * The greyscale ramp is the default, per DESIGN.md: a single series is not a
 * category, and eight greys would be a broken chart but one grey is a correct
 * one. A surface whose categories mean something (an outcome, a level) passes
 * its own tones.
 */
const DEFAULT_TONE = "var(--chart-3)";

export interface HistogramProps {
  data: FeedHistogram | undefined;
  /** Category → CSS colour. Categories not named fall back to the ramp. */
  tones?: Record<string, string>;
  /** Category order, bottom of the stack first. */
  order?: readonly string[];
  /** Applies a window as `[fromMs, toMs]`. */
  onZoom: (range: [number, number]) => void;
  isLoading?: boolean;
  height?: number;
  className?: string;
}

/**
 * Enter confirms the parked window, Escape discards it.
 *
 * Bound to the document rather than the chart: the drag ends with the pointer
 * over the plot and no element focused, so a handler on the container would
 * only fire if the reader thought to click it first.
 */
function ParkedKeys({
  selection,
  onCancel,
  onConfirm,
}: {
  selection: [number, number] | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  useEffect(() => {
    if (!selection) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
      if (event.key === "Enter") onConfirm();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [selection, onCancel, onConfirm]);
  return null;
}

export function DataTableHistogram({
  data,
  tones,
  order,
  onZoom,
  isLoading = false,
  height = 92,
  className,
}: HistogramProps) {
  /** Parked, not applied: the selection a drag proposed, awaiting confirmation. */
  const [parked, setParked] = useState<BrushRange<number> | null>(null);

  const buckets = data?.buckets ?? NO_BUCKETS;
  const bucketMs = data?.bucketMs ?? 60_000;
  const starts = useMemo(() => buckets.map((bucket) => bucket.at), [buckets]);

  const segments = useMemo<Segment[]>(() => {
    const rows: Segment[] = [];
    for (const bucket of buckets) {
      const entries = Object.entries(bucket.by);
      if (entries.length === 0) {
        rows.push({ at: bucket.at, category: UNCATEGORIZED, count: bucket.total });
        continue;
      }
      for (const [category, count] of entries) {
        rows.push({ at: bucket.at, category, count });
      }
    }
    return rows;
  }, [buckets]);

  const categories = useMemo(() => {
    const seen = new Set(segments.map((segment) => segment.category));
    const known = (order ?? []).filter((category) => seen.has(category));
    return [...known, ...[...seen].filter((category) => !known.includes(category)).sort()];
  }, [segments, order]);

  const definition = useMemo(
    () =>
      defineChart({
        marks: [
          barY(segments, {
            id: "buckets",
            x: "at",
            y: "count",
            z: "category",
            color: "category",
            inset: 0.5,
            radius: 1,
          }),
        ],
        x: {
          scale: () => scaleBand<number>().domain(starts).padding(0.12),
          axis: {
            line: false,
            // Only a handful of labels: a bucketed axis with forty stamps on it
            // is a texture, not a scale.
            ticks: { spacing: 110, size: 0, format: (value: number) => tick(value) },
          },
        },
        y: { scale: scaleLinear, nice: true, axis: false, grid: false },
        color: {
          scale: scaleOrdinal<string, string>,
          domain: categories,
          range: categories.map((category) => tones?.[category] ?? DEFAULT_TONE),
        },
        controls: [
          brushX({
            range: controlledSignal<BrushRange<number>, BrushXChange<number>>(
              parked ?? { start: starts[0] ?? 0, end: starts[0] ?? 0 },
              (next, { reason }) => {
                // Park on commit. Applying here would re-query on every stray
                // drag across a chart that sits above the rows being read.
                if (reason.type === "commit") setParked(next);
              },
            ),
            values: starts,
            format: (value: number) => stamp(value),
            ariaLabel: "Time window",
            startAriaLabel: "Window start",
            endAriaLabel: "Window end",
          }),
        ],
      }),
    [segments, starts, categories, tones, parked],
  );

  const hasRows = segments.some((segment) => segment.count > 0);

  if (isLoading && buckets.length === 0) {
    return <div className={cn("animate-pulse bg-muted/30", className)} style={{ height }} />;
  }

  if (buckets.length === 0 || !hasRows) {
    return (
      <div
        className={cn("flex items-center justify-center text-xs text-muted-foreground", className)}
        style={{ height }}
      >
        No activity in this window
      </div>
    );
  }

  const selection =
    parked && parked.start !== parked.end
      ? ([parked.start, parked.end + bucketMs - 1] satisfies [number, number])
      : null;

  return (
    <div className={cn("relative", className)}>
      <ParkedKeys
        selection={selection}
        onCancel={() => setParked(null)}
        onConfirm={() => {
          if (selection) onZoom(selection);
          setParked(null);
        }}
      />
      <Chart
        definition={definition}
        height={height}
        ariaLabel="Rows over time. Drag to select a window."
        className="otter-chart"
      />

      {selection ? (
        <div className="absolute inset-x-0 bottom-1 flex justify-center">
          <div className="flex items-center gap-2 rounded-lg bg-popover px-2 py-1 shadow-md ring-1 ring-foreground/10">
            <span className="font-mono text-[11px] text-muted-foreground">
              {stamp(selection[0])} → {stamp(selection[1])}
            </span>
            <Button variant="ghost" size="xs" className="h-6" onClick={() => setParked(null)}>
              Cancel
            </Button>
            <Button
              variant="outline"
              size="xs"
              className="h-6"
              onClick={() => {
                onZoom(selection);
                setParked(null);
              }}
            >
              Zoom
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
