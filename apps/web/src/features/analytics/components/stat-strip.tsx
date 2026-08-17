/**
 * Headline figures for the window: reference numbers, not the subject, so a
 * quiet strip rather than four boxed cards. Sub-lines carry the honest
 * qualifiers (bot share, visitor-days semantics, peak-day lower bound).
 */

import type { ReactNode } from "react";

import { Card } from "@/shared/components/ui/card";

export interface Stat {
  label: string;
  value: string;
  /** Muted qualifier under the value ("12% bots", "peak day 840"). */
  sub?: ReactNode;
  /** Hover explanation for labels that carry semantics ("visitor-days"). */
  title?: string;
}

export function StatStrip({ stats }: { stats: readonly Stat[] }) {
  return (
    <Card className="grid grid-cols-2 gap-x-4 gap-y-4 p-4 sm:grid-cols-3 lg:grid-cols-5">
      {stats.map((stat) => (
        <div key={stat.label} className="flex min-w-0 flex-col gap-1" title={stat.title}>
          <span className="truncate text-[10px] font-medium tracking-[0.1em] text-muted-foreground uppercase">
            {stat.label}
          </span>
          <span className="font-mono text-xl leading-none font-semibold tabular-nums">
            {stat.value}
          </span>
          {stat.sub ? (
            <span className="truncate font-mono text-[11px] text-muted-foreground tabular-nums">
              {stat.sub}
            </span>
          ) : null}
        </div>
      ))}
    </Card>
  );
}
