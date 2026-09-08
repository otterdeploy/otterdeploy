/**
 * Edge request volume, stacked by status class.
 *
 * An adapter over the shared histogram, for the same reason the runtime log
 * tail is one: this was a third hand-rolled bar chart, with its own stacking,
 * its own `toLocaleTimeString` clock and its own idea of what a hover should
 * say. A request volume chart and a log volume chart are the same instrument
 * pointed at different rows, and they should not be two implementations.
 *
 * What the shared component brings that this could not: a ranked tooltip that
 * names the bucket's span and totals the classes, drag-to-select with a
 * confirm step, and empty buckets drawn rather than skipped.
 */

import type { EdgeHistogramBucket } from "@otterdeploy/api/edge-logs/types";

import { useMemo } from "react";

import type { FeedHistogram } from "@/shared/components/data-table/feed/types";

import { DataTableHistogram } from "@/shared/components/data-table/parts/histogram";

import { type EdgeLogsData } from "./edge-logs-constants";

/**
 * Status class → paint.
 *
 * The semantic tokens, so a 5xx is the same red here as in the status column
 * and in every other failure in the product. 3xx borrows the info blue: a
 * redirect is neither a success to celebrate nor a problem to chase.
 */
const STATUS_TONES: Record<string, string> = {
  "2xx": "var(--success)",
  "3xx": "var(--info)",
  "4xx": "var(--warning)",
  "5xx": "var(--destructive)",
};

/** Bottom of the stack first: the ordinary case sits under the exceptions. */
const STATUS_ORDER = ["2xx", "3xx", "4xx", "5xx"] as const;

/** Only classes that actually occurred, so an absent one earns no legend key. */
function classesOf(bucket: EdgeHistogramBucket): Record<string, number> {
  const counts: Record<string, number> = {};
  if (bucket.c2xx > 0) counts["2xx"] = bucket.c2xx;
  if (bucket.c3xx > 0) counts["3xx"] = bucket.c3xx;
  if (bucket.c4xx > 0) counts["4xx"] = bucket.c4xx;
  if (bucket.c5xx > 0) counts["5xx"] = bucket.c5xx;
  return counts;
}

/** The bucket width, read off the data rather than assumed. */
function bucketMsOf(buckets: readonly EdgeHistogramBucket[]): number {
  const first = buckets[0] ? Date.parse(buckets[0].t) : Number.NaN;
  const second = buckets[1] ? Date.parse(buckets[1].t) : Number.NaN;
  const width = second - first;
  return Number.isFinite(width) && width > 0 ? width : 60_000;
}

export function LogHistogram({
  data,
  onSelectRange,
}: {
  data: EdgeLogsData | undefined;
  /** Confirming a drag narrows the window, when the caller can take one. */
  onSelectRange?: (range: [number, number]) => void;
}) {
  const raw = data?.histogram;

  const histogram = useMemo<FeedHistogram | undefined>(() => {
    if (!raw || raw.length === 0) return undefined;
    return {
      bucketMs: bucketMsOf(raw),
      buckets: raw.flatMap((bucket) => {
        const at = Date.parse(bucket.t);
        if (Number.isNaN(at)) return [];
        const by = classesOf(bucket);
        const total = bucket.c2xx + bucket.c3xx + bucket.c4xx + bucket.c5xx;
        return [{ at, total, by }];
      }),
    };
  }, [raw]);

  return (
    <div className="border-b px-4 pt-3 pb-2">
      <div className="mb-1 flex items-center text-xs">
        <span className="text-muted-foreground">Volume</span>
        <div className="flex-1" />
        <span className="font-mono text-muted-foreground tabular-nums">
          {data?.total ?? 0} matched
        </span>
      </div>

      <DataTableHistogram
        data={histogram}
        tones={STATUS_TONES}
        order={STATUS_ORDER}
        height={56}
        onZoom={(range) => onSelectRange?.(range)}
      />
    </div>
  );
}
