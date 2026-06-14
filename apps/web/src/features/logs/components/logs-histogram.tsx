import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useMemo, useState } from "react";

import {
  bucketize,
  HISTOGRAM_BUCKET_MS,
  HISTOGRAM_BUCKETS,
  type HistogramBucket,
} from "../data/histogram";
import { LEVEL_STRIPE, type LogLine } from "../data/use-project-log-stream";

export interface TimeRange {
  from: number;
  to: number;
}

interface LogsHistogramProps {
  lines: LogLine[];
  loadedCount: number;
  matchCount: number;
  /** Active time-window filter, or null. */
  selectedRange: TimeRange | null;
  /** Click a bucket or drag across several to set the window; clicking the
   *  active single bucket clears it. */
  onSelectRange: (range: TimeRange | null) => void;
}

function clockHM(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function LogsHistogram({
  lines,
  loadedCount,
  matchCount,
  selectedRange,
  onSelectRange,
}: LogsHistogramProps) {
  // Capture `now` once alongside the counts so the bars and their click windows
  // share the same bucket boundaries.
  const { buckets, starts } = useMemo(() => {
    const now = Date.now();
    const earliest = now - HISTOGRAM_BUCKETS * HISTOGRAM_BUCKET_MS;
    return {
      buckets: bucketize(lines, now),
      starts: Array.from(
        { length: HISTOGRAM_BUCKETS },
        (_, i) => earliest + i * HISTOGRAM_BUCKET_MS,
      ),
    };
  }, [lines]);

  const histoMax = useMemo(
    () => Math.max(1, ...buckets.map(totalCount)),
    [buckets],
  );

  // Drag selection: anchor = where the press started, hover = bucket under the
  // pointer now. Committed on pointerup (even if released outside the chart).
  const [drag, setDrag] = useState<{ anchor: number; hover: number } | null>(
    null,
  );

  useEffect(() => {
    if (!drag) return;
    const commit = () => {
      const lo = Math.min(drag.anchor, drag.hover);
      const hi = Math.max(drag.anchor, drag.hover);
      const from = starts[lo]!;
      const to = starts[hi]! + HISTOGRAM_BUCKET_MS;
      if (lo === hi) {
        // Plain click on a single bucket toggles it.
        const active =
          selectedRange &&
          from < selectedRange.to &&
          to > selectedRange.from;
        onSelectRange(active ? null : { from, to });
      } else {
        onSelectRange({ from, to });
      }
      setDrag(null);
    };
    window.addEventListener("pointerup", commit);
    return () => window.removeEventListener("pointerup", commit);
  }, [drag, starts, selectedRange, onSelectRange]);

  // The contiguous bucket span to frame: the live drag preview takes precedence
  // over the committed range. One [lo, hi] drives a single continuous box rather
  // than a ring per bucket.
  const span = useMemo(() => {
    if (drag) {
      return {
        lo: Math.min(drag.anchor, drag.hover),
        hi: Math.max(drag.anchor, drag.hover),
      };
    }
    if (!selectedRange) return null;
    let lo = -1;
    let hi = -1;
    for (let i = 0; i < starts.length; i++) {
      const s = starts[i]!;
      if (s < selectedRange.to && s + HISTOGRAM_BUCKET_MS > selectedRange.from) {
        if (lo === -1) lo = i;
        hi = i;
      }
    }
    return lo === -1 ? null : { lo, hi };
  }, [drag, selectedRange, starts]);

  return (
    <div className="border-b px-5 pt-4 pb-2.5">
      <div className="mb-2 flex items-center gap-2 text-[11px]">
        <span className="uppercase tracking-[0.06em] text-muted-foreground">
          Volume · last 30m
        </span>
        {selectedRange && (
          <button
            type="button"
            onClick={() => onSelectRange(null)}
            className="flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 font-mono text-[10px] text-foreground hover:bg-muted/70"
            title="Clear time filter"
          >
            {clockHM(selectedRange.from)}–{clockHM(selectedRange.to)}
            <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} className="size-3" />
          </button>
        )}
        <div className="flex-1" />
        <span className="font-mono text-muted-foreground">
          {loadedCount} loaded · {matchCount} match
        </span>
      </div>
      <div className="relative flex h-14 items-stretch gap-0.5 select-none">
        {buckets.map((b, i) => {
          const start = starts[i]!;
          const end = start + HISTOGRAM_BUCKET_MS;
          // Key by positional index, not `start`: `start` is an absolute
          // timestamp that slides every time the live tail recomputes `now`,
          // which would remount all 30 bars on every tick (the visible jump).
          return (
            <Bar
              key={i}
              bucket={b}
              max={histoMax}
              start={start}
              end={end}
              dimmed={span ? i < span.lo || i > span.hi : false}
              onPointerDown={() => setDrag({ anchor: i, hover: i })}
              onPointerEnter={() =>
                setDrag((d) => (d ? { ...d, hover: i } : d))
              }
            />
          );
        })}

        {/* Single continuous frame over the spanned buckets (gaps included)
            instead of one ring per bucket. Bars are equal-width `flex-1` with a
            2px (gap-0.5) gutter, so the geometry is exact via calc. */}
        {span && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-y-0 rounded-md bg-primary/10 ring-1 ring-primary/50"
            style={{
              left: `calc((100% - ${(HISTOGRAM_BUCKETS - 1) * BAR_GAP_PX}px) / ${HISTOGRAM_BUCKETS} * ${span.lo} + ${span.lo * BAR_GAP_PX}px)`,
              width: `calc((100% - ${(HISTOGRAM_BUCKETS - 1) * BAR_GAP_PX}px) / ${HISTOGRAM_BUCKETS} * ${span.hi - span.lo + 1} + ${(span.hi - span.lo) * BAR_GAP_PX}px)`,
            }}
          />
        )}
      </div>
      <div className="mt-1 flex font-mono text-[10px] text-muted-foreground/70">
        <span>−30m</span>
        <div className="flex-1" />
        <span>now</span>
      </div>
    </div>
  );
}

// Matches the `gap-0.5` (0.125rem = 2px) gutter between bars; the selection
// frame's calc geometry depends on this staying in sync with the className.
const BAR_GAP_PX = 2;

function totalCount(b: HistogramBucket) {
  return b.info + b.warn + b.error + b.debug;
}

function Bar({
  bucket,
  max,
  start,
  end,
  dimmed,
  onPointerDown,
  onPointerEnter,
}: {
  bucket: HistogramBucket;
  max: number;
  start: number;
  end: number;
  dimmed: boolean;
  onPointerDown: () => void;
  onPointerEnter: () => void;
}) {
  const total = totalCount(bucket);
  const pct = (n: number) => (total ? (n / total) * 100 : 0);
  return (
    <button
      type="button"
      onPointerDown={onPointerDown}
      onPointerEnter={onPointerEnter}
      title={`${clockHM(start)}–${clockHM(end)} · ${total} events`}
      className={cnBar(dimmed)}
    >
      <div
        className="flex w-full flex-col-reverse overflow-hidden rounded-[1px]"
        style={{ height: `${(total / max) * 100}%` }}
      >
        <span className={LEVEL_STRIPE.info} style={{ height: `${pct(bucket.info)}%` }} />
        <span className={LEVEL_STRIPE.debug} style={{ height: `${pct(bucket.debug)}%` }} />
        <span className={LEVEL_STRIPE.warn} style={{ height: `${pct(bucket.warn)}%` }} />
        <span className={LEVEL_STRIPE.error} style={{ height: `${pct(bucket.error)}%` }} />
      </div>
    </button>
  );
}

function cnBar(dimmed: boolean): string {
  const base =
    "flex h-full min-h-px flex-1 cursor-pointer flex-col justify-end rounded-sm transition-opacity hover:bg-muted/30";
  return dimmed ? `${base} opacity-35 hover:opacity-80` : base;
}
