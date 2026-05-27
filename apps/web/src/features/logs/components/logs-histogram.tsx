import { useMemo } from "react";

import { bucketize, type HistogramBucket } from "../data/histogram";
import type { LogLine } from "../data/use-project-log-stream";
import { LEVEL_STRIPE } from "./log-row";

interface LogsHistogramProps {
  lines: LogLine[];
  loadedCount: number;
  matchCount: number;
}

export function LogsHistogram({ lines, loadedCount, matchCount }: LogsHistogramProps) {
  const histo = useMemo(() => bucketize(lines), [lines]);
  const histoMax = useMemo(
    () => Math.max(1, ...histo.map(totalCount)),
    [histo],
  );

  return (
    <div className="border-b px-5 pt-4 pb-2.5">
      <div className="mb-2 flex items-center text-[11px]">
        <span className="uppercase tracking-[0.06em] text-muted-foreground">
          Volume · last 30m
        </span>
        <div className="flex-1" />
        <span className="font-mono text-muted-foreground">
          {loadedCount} loaded · {matchCount} match
        </span>
      </div>
      <div className="flex h-14 items-end gap-0.5">
        {histo.map((b, i) => (
          <Bar key={i} bucket={b} max={histoMax} />
        ))}
      </div>
      <div className="mt-1 flex font-mono text-[10px] text-muted-foreground/70">
        <span>−30m</span>
        <div className="flex-1" />
        <span>now</span>
      </div>
    </div>
  );
}

function totalCount(b: HistogramBucket) {
  return b.info + b.warn + b.error + b.debug;
}

function Bar({ bucket, max }: { bucket: HistogramBucket; max: number }) {
  const total = totalCount(bucket);
  const h = (total / max) * 56;
  const pct = (n: number) => (total ? (n / total) * 100 : 0);
  return (
    <div
      title={`${total} events`}
      className="flex min-h-px flex-1 flex-col-reverse"
      style={{ height: `${h}px` }}
    >
      <span className={LEVEL_STRIPE.info} style={{ height: `${pct(bucket.info)}%` }} />
      <span className={LEVEL_STRIPE.debug} style={{ height: `${pct(bucket.debug)}%` }} />
      <span className={LEVEL_STRIPE.warn} style={{ height: `${pct(bucket.warn)}%` }} />
      <span className={LEVEL_STRIPE.error} style={{ height: `${pct(bucket.error)}%` }} />
    </div>
  );
}
