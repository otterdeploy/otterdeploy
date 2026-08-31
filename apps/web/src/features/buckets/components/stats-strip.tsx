/**
 * The stats strip. Its numbers describe the CURRENT scope — the prefix walked
 * into plus the filter tokens — because "what is `exports/` costing me" and
 * "how much of this is GLACIER" are the questions a browser-only viewer
 * cannot answer. That re-scoping is the whole reason the strip exists.
 *
 * Honesty rules: a partial scan says "first N keys" and never poses as a
 * total; the cost estimate appears only for buckets on AWS proper (other
 * endpoints bill from other price sheets) and is labelled as the storage
 * line only. There is no growth sparkline because nothing here records
 * history yet — a made-up curve would be decoration lying about data.
 */
import { formatNumber } from "@otterdeploy/shared/format";

import type { BucketRow } from "../data/buckets-data";

import { estimatedMonthlyUsd, formatSize } from "../state";

interface Stats {
  objects: number;
  bytes: number;
  byClass: { storageClass: string; count: number; bytes: number }[];
  staleCount: number;
  largeCount: number;
  scannedKeys: number;
  complete: boolean;
}

export function StatsStrip({
  bucket,
  stats,
  isLoading,
  prefix,
  q,
}: {
  bucket: BucketRow;
  stats: Stats | undefined;
  isLoading: boolean;
  prefix: string;
  q: string;
}) {
  if (isLoading && stats === undefined) {
    return (
      <div className="flex shrink-0 border-b motion-safe:animate-in motion-safe:duration-200 motion-safe:fade-in-0 motion-safe:slide-in-from-top-1">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex-1 border-r px-3 py-2 last:border-r-0">
            <div className="h-9 animate-pulse rounded bg-muted/60" />
          </div>
        ))}
      </div>
    );
  }
  if (stats === undefined) return null;

  const scoped = prefix !== "" || q !== "";
  const scopeLabel = [prefix === "" ? null : prefix, q === "" ? null : q].filter(Boolean).join(" ");
  const coverage = stats.complete
    ? scoped
      ? `matching ${scopeLabel}`
      : "whole bucket"
    : `first ${formatNumber(stats.scannedKeys)} keys${scoped ? ` · ${scopeLabel}` : ""}`;

  const classDetail =
    stats.byClass
      .slice(0, 3)
      .map((c) => `${c.storageClass} ${formatSize(c.bytes)}`)
      .join(" · ") || "—";

  const usd = bucket.endpoint === null ? estimatedMonthlyUsd(stats.byClass) : null;

  return (
    <div className="flex shrink-0 border-b motion-safe:animate-in motion-safe:duration-200 motion-safe:fade-in-0 motion-safe:slide-in-from-top-1">
      <Stat label="Objects" value={formatNumber(stats.objects)} detail={coverage} />
      <Stat label="Size" value={formatSize(stats.bytes)} detail={classDetail} />
      <Stat
        label="Est. monthly"
        value={usd === null ? "—" : `$${usd.toFixed(2)}`}
        detail={
          usd === null
            ? bucket.endpoint === null
              ? "no list price for a class here"
              : "unknown pricing for this endpoint"
            : "storage only · AWS list prices"
        }
      />
      <Stat
        label="Untouched 1y"
        value={formatNumber(stats.staleCount)}
        detail={`${formatNumber(stats.largeCount)} over 100 MB`}
      />
    </div>
  );
}

function Stat({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="min-w-0 flex-1 border-r px-3 py-2 last:border-r-0">
      <div className="font-mono text-[9.5px] tracking-[0.07em] text-muted-foreground uppercase">
        {label}
      </div>
      <div className="mt-0.5 text-[16px] font-semibold tracking-[-0.02em]">{value}</div>
      <div className="truncate font-mono text-[10px] text-muted-foreground" title={detail}>
        {detail}
      </div>
    </div>
  );
}
