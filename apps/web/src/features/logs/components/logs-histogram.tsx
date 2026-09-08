/**
 * Log volume over the tail window.
 *
 * An adapter, not a chart. It used to be ~240 lines of hand-rolled bars with
 * its own drag-selection, its own colour mapping, its own tick formatting and
 * its own `new Date()` clock — a second charting implementation living beside
 * the one every other surface uses, and drifting from it in all four.
 *
 * Now it buckets the live buffer and hands the result to the shared histogram,
 * so a log tail and an audit feed are read with the same instrument: the same
 * bars, the same ranked tooltip, the same drag-to-select-then-confirm (a stray
 * drag over a live tail must not silently narrow it), and the same tokens.
 *
 * What stays here is what is genuinely the log tail's own: the window is
 * anchored to the buffer rather than to a server range, and the selection is
 * the page's time filter rather than a URL-held one.
 */

import { useMemo, useState } from "react";

import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Temporal } from "@otterdeploy/shared/temporal";
import { useTranslation } from "react-i18next";

import type { FeedHistogram } from "@/shared/components/data-table/feed/types";

import { DataTableHistogram } from "@/shared/components/data-table/parts/histogram";
import { CLOCK_MINUTES, clockFormatter } from "@/shared/lib/clock";

import {
  bucketize,
  HISTOGRAM_BUCKET_MS,
  HISTOGRAM_BUCKETS,
  type HistogramBucket,
} from "../data/histogram";
import { LOG_LEVELS, type LogLine } from "../data/use-project-log-stream";

const clockHM = clockFormatter(CLOCK_MINUTES);

/**
 * Level → paint, from the semantic tokens rather than from a chart palette.
 *
 * A log level is a state, and DESIGN.md's state colours are what the rest of
 * the app already paints it with: the same red in the histogram, the level
 * chip and the row text means the eye only learns it once.
 */
const LEVEL_TONES: Record<string, string> = {
  debug: "var(--muted-foreground)",
  info: "var(--info)",
  warn: "var(--warning)",
  error: "var(--destructive)",
};

/** Bottom of the stack first: the ordinary case sits under the exceptions. */
const LEVEL_ORDER = [...LOG_LEVELS];

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
  /** Confirming a drag sets the window; the chip beside the title clears it. */
  onSelectRange: (range: TimeRange | null) => void;
}

function bucketTotal(bucket: HistogramBucket): number {
  return bucket.debug + bucket.info + bucket.warn + bucket.error;
}

export function LogsHistogram({
  lines,
  loadedCount,
  matchCount,
  selectedRange,
  onSelectRange,
}: LogsHistogramProps) {
  const { t } = useTranslation();

  // `now` anchors the window. Wall-clock is impure to read during render, and
  // the window only ever advanced when `lines` changed anyway, so it comes from
  // the data: the newest line's timestamp, floored at mount so an idle tail
  // keeps showing the last thirty real minutes rather than scrolling back to
  // whenever the buffer's last line happened to land.
  const [mountedAt] = useState(() => Temporal.Now.instant().epochMilliseconds);
  const now = useMemo(() => {
    let latest = mountedAt;
    for (const line of lines) {
      if (line.tsMs !== null && line.tsMs > latest) latest = line.tsMs;
    }
    return latest;
  }, [lines, mountedAt]);

  const data = useMemo<FeedHistogram>(() => {
    const earliest = now - HISTOGRAM_BUCKETS * HISTOGRAM_BUCKET_MS;
    const counted = bucketize(lines, now);
    return {
      bucketMs: HISTOGRAM_BUCKET_MS,
      buckets: counted.map((bucket, index) => ({
        at: earliest + index * HISTOGRAM_BUCKET_MS,
        total: bucketTotal(bucket),
        // Levels with no lines in this bucket are left out rather than sent as
        // zeroes: a series that is absent everywhere should not earn a key in
        // the legend just because the bucket exists.
        by: Object.fromEntries(
          LEVEL_ORDER.map((level) => [level, bucket[level]] as const).filter(
            ([, count]) => count > 0,
          ),
        ),
      })),
    };
  }, [lines, now]);

  return (
    <div className="border-b px-5 pt-4 pb-2">
      <div className="mb-1 flex items-center gap-2 text-xs">
        <span className="text-muted-foreground">{t("logs.volumeLast30m")}</span>
        {selectedRange && (
          <button
            type="button"
            onClick={() => onSelectRange(null)}
            className="flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 font-mono text-foreground hover:bg-muted/70"
            title={t("logs.clearTimeFilter")}
          >
            {clockHM(selectedRange.from)}–{clockHM(selectedRange.to)}
            <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} className="size-3" />
          </button>
        )}
        <div className="flex-1" />
        <span className="font-mono text-muted-foreground tabular-nums">
          {loadedCount} loaded · {matchCount} match
        </span>
      </div>

      <DataTableHistogram
        data={data}
        tones={LEVEL_TONES}
        order={LEVEL_ORDER}
        height={56}
        onZoom={([from, to]) => onSelectRange({ from, to })}
      />
    </div>
  );
}
