/**
 * Headline figures, one small card each, Plausible-style: value, a trend
 * delta against the equal-length previous window (green when it moved the
 * good way — for latency and errors that's DOWN), the honest qualifier line,
 * and a spark showing the shape.
 */

import type { ReactNode } from "react";

import { Card } from "@/shared/components/ui/card";
import { cn } from "@/shared/lib/utils";

import { Sparkline } from "./sparkline";

export interface StatDelta {
  /** Fractional change vs the previous window; null = previous was zero. */
  pct: number | null;
  /** Latency/error-style metrics: a decrease is the good direction. */
  goodWhenDown?: boolean;
}

export interface Stat {
  label: string;
  value: string;
  /** Muted qualifier under the value ("12% bots", "peak day 840"). */
  sub?: ReactNode;
  /** Hover explanation for labels that carry semantics ("visitor-days"). */
  title?: string;
  /** Per-bucket shape of this figure over the window; omitted = no spark. */
  spark?: readonly number[];
  delta?: StatDelta;
}

/** Fractional change, null when there is no previous baseline to compare. */
export function deltaPct(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return (current - previous) / previous;
}

function DeltaBadge({ delta }: { delta: StatDelta }) {
  if (delta.pct === null) return null;
  const pct = delta.pct * 100;
  // Sub-half-percent movement is noise, not a trend.
  if (Math.abs(pct) < 0.5) {
    return <span className="font-mono text-[11px] text-muted-foreground tabular-nums">±0%</span>;
  }
  const up = delta.pct > 0;
  const good = delta.goodWhenDown ? !up : up;
  return (
    <span
      className={cn(
        "font-mono text-[11px] tabular-nums",
        good ? "text-success" : "text-destructive",
      )}
    >
      {up ? "↗" : "↘"} {Math.abs(pct) >= 100 ? Math.round(Math.abs(pct)) : Math.abs(pct).toFixed(1)}
      %
    </span>
  );
}

export function StatStrip({ stats }: { stats: readonly Stat[] }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {stats.map((stat) => (
        <Card
          key={stat.label}
          className="flex flex-col gap-1 overflow-hidden p-4"
          title={stat.title}
        >
          <span className="truncate text-[10px] font-medium tracking-[0.1em] text-muted-foreground uppercase">
            {stat.label}
          </span>
          <span className="flex items-baseline gap-2">
            <span className="font-mono text-xl leading-none font-semibold tabular-nums">
              {stat.value}
            </span>
            {stat.delta ? <DeltaBadge delta={stat.delta} /> : null}
          </span>
          {stat.sub ? (
            <span className="truncate font-mono text-[11px] text-muted-foreground tabular-nums">
              {stat.sub}
            </span>
          ) : null}
          {stat.spark ? <Sparkline values={stat.spark} /> : null}
        </Card>
      ))}
    </div>
  );
}
