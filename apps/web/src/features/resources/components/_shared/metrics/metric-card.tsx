/**
 * Card shell for a single metric: an icon + title on the left, the current
 * value and a couple of window-level stats on the right, and the time-series
 * chart below. Presentational — the metrics tab feeds it the headline string,
 * stat chips, and chart element.
 */

import type { ReactNode } from "react";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";

import { Card } from "@/shared/components/ui/card";

export interface MetricStat {
  label: string;
  value: string;
}

interface MetricCardProps {
  icon: IconSvgElement;
  title: string;
  /** The big current reading, e.g. `18%`, `412 MB`. A node for multi-value
   *  metrics such as network in/out. */
  value: ReactNode;
  /** Muted secondary readings shown under the headline (peak / avg / limit). */
  stats?: MetricStat[];
  children: ReactNode;
}

export function MetricCard({
  icon,
  title,
  value,
  stats,
  children,
}: MetricCardProps) {
  return (
    <Card className="gap-0 overflow-hidden p-0">
      <div className="flex items-start justify-between gap-4 px-4 pt-4">
        <div className="flex items-center gap-2.5">
          <span className="flex size-7 items-center justify-center rounded-md bg-muted text-foreground">
            <HugeiconsIcon icon={icon} strokeWidth={2} className="size-4" />
          </span>
          <span className="text-sm font-medium">{title}</span>
        </div>
        <div className="flex flex-col items-end gap-0.5">
          <div className="font-mono text-2xl font-semibold leading-none tabular-nums">
            {value}
          </div>
          {stats && stats.length > 0 ? (
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              {stats.map((s, i) => (
                <span key={s.label} className="flex items-center gap-1.5">
                  {i > 0 ? (
                    <span className="text-muted-foreground/40">·</span>
                  ) : null}
                  <span>
                    {s.label}{" "}
                    <span className="font-mono tabular-nums text-foreground/80">
                      {s.value}
                    </span>
                  </span>
                </span>
              ))}
            </div>
          ) : null}
        </div>
      </div>
      <div className="px-1 pt-3 pb-1">{children}</div>
    </Card>
  );
}
