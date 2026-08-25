/**
 * Section shell for one metric: a hairline-ringed panel whose header names
 * the series (title plus a swatch in the series colour) and carries the
 * current reading with a couple of window-level stats, over a full-width
 * chart. Presentational: the metrics surfaces feed it the strings and the
 * chart element.
 *
 * The header is deliberately quiet — one line, small type — so the chart is
 * the thing you look at. The reading sits at the right edge in mono, where
 * the eye lands after following the line to its newest point.
 */

import type { ReactNode } from "react";

export interface MetricStat {
  label: string;
  value: string;
}

interface MetricCardProps {
  title: string;
  /** Series colour, drawn as a dot before the title so the header names the
   *  line without a legend. Omit for multi-series panels that carry one. */
  swatch?: string;
  /** The current reading, e.g. `18%`, `412 MB`. A node for multi-value
   *  metrics such as network in/out. */
  value: ReactNode;
  /** Muted window-level readings shown before the headline (peak / avg /
   *  limit). Labelled, so `18%` next to `peak 24%` reads as two facts rather
   *  than one bug. */
  stats?: MetricStat[];
  children: ReactNode;
}

export function MetricCard({ title, swatch, value, stats, children }: MetricCardProps) {
  return (
    <section className="overflow-hidden rounded-lg bg-card ring-1 ring-foreground/10">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-border px-4 py-2.5">
        <h3 className="flex items-center gap-2 text-sm font-medium">
          {swatch ? (
            <span
              aria-hidden="true"
              className="size-2 shrink-0 rounded-full"
              style={{ background: swatch }}
            />
          ) : null}
          {title}
        </h3>
        <div className="flex items-baseline gap-3">
          {stats && stats.length > 0 ? (
            <div className="flex items-baseline gap-2.5 text-[11px] text-muted-foreground">
              {stats.map((s) => (
                <span key={s.label}>
                  {s.label}{" "}
                  <span className="font-mono text-foreground/80 tabular-nums">{s.value}</span>
                </span>
              ))}
            </div>
          ) : null}
          <div className="font-mono text-sm font-medium tabular-nums">{value}</div>
        </div>
      </div>
      <div className="px-2 pt-4 pb-1">{children}</div>
    </section>
  );
}
