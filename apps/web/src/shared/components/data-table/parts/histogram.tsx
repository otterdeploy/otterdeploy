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

import type { BrushRange } from "@tanstack/charts/interaction/brush";

import { useEffect, useMemo, useState } from "react";

import { Chart } from "@tanstack/charts/react/tooltip";

import type { FeedHistogram } from "@/shared/components/data-table/feed/types";

import { useHistogramDefinition } from "@/shared/components/data-table/parts/histogram-chart";
import { HistogramLegend } from "@/shared/components/data-table/parts/histogram-legend";
import {
  HistogramTooltip,
  type Segment,
} from "@/shared/components/data-table/parts/histogram-tooltip";
import { Button } from "@/shared/components/ui/button";
import { CLOCK_STAMP, utcFormatter } from "@/shared/lib/clock";
import { cn } from "@/shared/lib/utils";

const stamp = utcFormatter(CLOCK_STAMP);

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
  /** The filter whose values the categories are, if they are a column's values. */
  categoryKey?: string;
  isLoading?: boolean;
  height?: number;
  className?: string;
}

/**
 * The parked window: what a drag proposed, and the two ways out of it.
 *
 * Enter confirms and Escape discards, bound to the document rather than to the
 * chart: a drag ends with the pointer over the plot and nothing focused, so a
 * handler on the container would only fire if the reader thought to click it
 * first. The buttons say the same two things for anyone who did not read that
 * off a keyboard hint.
 */
function ParkedWindow({
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

  if (!selection) return null;

  return (
    // In flow BELOW the chart, not floating over it. Absolutely positioned at
    // `bottom-1` it landed on the x-axis and on the right-hand end of its own
    // selection — so the strip asking "zoom to this window?" covered both the
    // window and the labels naming it. It wraps rather than overflowing, so a
    // narrow table keeps Cancel and Zoom reachable.
    <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 px-2 pt-1.5 pb-1">
      <span className="font-mono text-[11px] whitespace-nowrap text-muted-foreground">
        {stamp(selection[0])} → {stamp(selection[1])}
      </span>
      <span className="flex shrink-0 items-center gap-1">
        <Button variant="ghost" size="xs" className="h-6" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="outline" size="xs" className="h-6" onClick={onConfirm}>
          Zoom
        </Button>
      </span>
    </div>
  );
}

/**
 * The parked window as an inclusive `[from, to]`, or null when none is parked.
 *
 * A zero-width brush is not a selection: the controlled signal idles at
 * `start === end` on the first bucket, and treating that as a window is what
 * would offer to zoom into a range the reader never dragged.
 */
function selectionOf(parked: BrushRange<number> | null, bucketMs: number): [number, number] | null {
  if (parked === null || parked.start === parked.end) return null;
  // The bucket the brush ends ON is included, so the window runs to the last
  // millisecond that bucket covers rather than to its start.
  return [parked.start, parked.end + bucketMs - 1];
}

export function DataTableHistogram({
  data,
  tones,
  order,
  onZoom,
  categoryKey,
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
        // Kept even at zero: the band scale's domain is every bucket start, and
        // a bucket with no segment at all leaves the x-axis with a position it
        // cannot map. What an empty bucket must NOT do is name a category —
        // see `categories` below.
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
    // Only categories that actually OCCUR. An empty bucket carries a
    // zero-count `UNCATEGORIZED` segment so the x-axis stays mappable, and
    // counting that as a category put a stray "rows" swatch in the legend of
    // every categorised feed with a quiet minute in its window — the audit log
    // included, beside success/failure/denied.
    const seen = new Set(
      segments.filter((segment) => segment.count > 0).map((segment) => segment.category),
    );
    const known = (order ?? []).filter((category) => seen.has(category));
    return [...known, ...[...seen].filter((category) => !known.includes(category)).sort()];
  }, [segments, order]);

  const definition = useHistogramDefinition({
    segments,
    starts,
    categories,
    tones,
    defaultTone: DEFAULT_TONE,
    parked,
    onPark: setParked,
    bucketMs,
  });

  const hasRows = segments.some((segment) => segment.count > 0);
  // One category is not a legend: a single grey chip labelled "rows" tells the
  // reader nothing they cannot see.
  const categorized = categories.length > 1 || categories[0] !== UNCATEGORIZED;

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

  const selection = selectionOf(parked, bucketMs);

  return (
    <div
      className={cn(
        "relative",
        // Nothing is selected, so nothing draws a selection. The brush parks its
        // two 24px handles at the first bucket when its range is empty, and they
        // painted there as a solid accent slab over the left edge of the chart —
        // a window the reader never opened, sitting on top of real bars. Dragging
        // anywhere on the plot still starts one; the handles are for resizing a
        // selection that exists, so they appear with it.
        selection === null && "[&_rect.handle]:hidden [&_rect.selection]:hidden",
        className,
      )}
    >
      {categorized ? (
        <div className="absolute top-0 right-1 z-10">
          <HistogramLegend
            categories={categories}
            tones={tones}
            filterKey={categoryKey}
            defaultTone={DEFAULT_TONE}
          />
        </div>
      ) : null}

      <div style={{ height }}>
        <Chart
          definition={definition}
          height={height}
          ariaLabel="Rows over time. Drag to select a window."
          className="otter-chart"
          renderTooltipBody={({ points }) => (
            <HistogramTooltip points={points} bucketMs={bucketMs} uncategorized={!categorized} />
          )}
        />
      </div>

      <ParkedWindow
        selection={selection}
        onCancel={() => setParked(null)}
        onConfirm={() => {
          if (selection) onZoom(selection);
          setParked(null);
        }}
      />
    </div>
  );
}
