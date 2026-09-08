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
import { CLOCK_STAMP, clockFormatter } from "@/shared/lib/clock";
import { cn } from "@/shared/lib/utils";

const stamp = clockFormatter(CLOCK_STAMP);

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
    <div className="absolute inset-x-0 bottom-1 flex justify-center">
      <div className="flex items-center gap-2 rounded-lg bg-popover px-2 py-1 shadow-md ring-1 ring-foreground/10">
        <span className="font-mono text-xs text-muted-foreground">
          {stamp(selection[0])} → {stamp(selection[1])}
        </span>
        <Button variant="ghost" size="xs" className="h-6" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="outline" size="xs" className="h-6" onClick={onConfirm}>
          Zoom
        </Button>
      </div>
    </div>
  );
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

  /**
   * Whether this feed breaks its buckets down at all.
   *
   * Decided over the WHOLE histogram, not per bucket. Deciding per bucket meant
   * every materialized empty bucket contributed a segment under the fallback
   * name, so a categorised feed grew a phantom "rows" series in its legend and
   * its colour domain — visible on the audit log as a fourth key beside
   * success, failure and denied.
   */
  const hasCategories = useMemo(
    () => buckets.some((bucket) => Object.keys(bucket.by).length > 0),
    [buckets],
  );

  const segments = useMemo<Segment[]>(() => {
    const rows: Segment[] = [];
    for (const bucket of buckets) {
      if (!hasCategories) {
        rows.push({ at: bucket.at, category: UNCATEGORIZED, count: bucket.total });
        continue;
      }
      for (const [category, count] of Object.entries(bucket.by)) {
        rows.push({ at: bucket.at, category, count });
      }
    }
    return rows;
  }, [buckets, hasCategories]);

  const categories = useMemo(() => {
    const seen = new Set(segments.map((segment) => segment.category));
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
  });

  const hasRows = segments.some((segment) => segment.count > 0);
  // One series is not a legend: a single grey chip labelled "rows" tells the
  // reader nothing they cannot already see.
  const categorized = hasCategories && categories.length > 0;

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
      {/* Above the plot, not over it: a legend floating on the bars covers the
          tallest ones, which are the bars the reader came for. */}
      {categorized ? (
        <div className="flex justify-end pb-1">
          <HistogramLegend
            categories={categories}
            tones={tones}
            filterKey={categoryKey}
            defaultTone={DEFAULT_TONE}
          />
        </div>
      ) : null}

      <Chart
        definition={definition}
        height={height}
        ariaLabel="Rows over time. Drag to select a window."
        className="otter-chart"
        renderTooltipBody={({ points }) => (
          <HistogramTooltip points={points} bucketMs={bucketMs} uncategorized={!categorized} />
        )}
      />

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
