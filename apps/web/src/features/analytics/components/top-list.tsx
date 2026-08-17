/**
 * Ranked breakdown list: label, proportional bar, count + share. The bar is
 * scaled against the LARGEST entry (not the total) so mid-list entries stay
 * visually comparable; the share column carries the of-total truth.
 */

import type { ReactNode } from "react";

import { Card } from "@/shared/components/ui/card";

import { formatCount, formatShare, type TopEntry } from "../analytics-model";

interface TopListProps {
  title: string;
  entries: readonly TopEntry[];
  /** Of-total denominator for the share column. */
  total: number;
  /** Rows rendered before scrolling; the rest stay reachable by scroll. */
  visibleRows?: number;
  /** Custom label renderer (e.g. country code → name). */
  renderKey?: (key: string) => ReactNode;
  /** Shown when there are no entries. */
  emptyNote: string;
}

export function TopList({
  title,
  entries,
  total,
  visibleRows = 8,
  renderKey,
  emptyNote,
}: TopListProps) {
  const max = entries.reduce((m, e) => Math.max(m, e.count), 0);
  // ~2.25rem per row + header; enough to show `visibleRows` before scrolling.
  const maxHeight = `${2.25 * visibleRows + 0.5}rem`;

  return (
    <Card className="gap-0 overflow-hidden p-0">
      <div className="flex items-baseline justify-between px-4 pt-3 pb-2">
        <span className="text-sm font-medium">{title}</span>
        {entries.length > 0 ? (
          <span className="font-mono text-[11px] text-muted-foreground tabular-nums">
            {entries.length}
          </span>
        ) : null}
      </div>
      {entries.length === 0 ? (
        <p className="px-4 pb-4 text-xs text-muted-foreground">{emptyNote}</p>
      ) : (
        <ul className="overflow-y-auto px-2 pb-2" style={{ maxHeight }}>
          {entries.map((entry) => (
            <li key={entry.key} className="relative flex items-center gap-3 rounded-sm px-2 py-1.5">
              {/* Proportional bar behind the row text: quiet, hairline-free. */}
              <span
                aria-hidden
                className="absolute inset-y-1 left-0 rounded-sm bg-muted"
                style={{ width: max > 0 ? `${(entry.count / max) * 100}%` : 0 }}
              />
              <span className="relative min-w-0 flex-1 truncate font-mono text-xs">
                {renderKey ? renderKey(entry.key) : entry.key}
              </span>
              <span className="relative font-mono text-xs text-foreground tabular-nums">
                {formatCount(entry.count)}
              </span>
              <span className="relative w-12 text-right font-mono text-[11px] text-muted-foreground tabular-nums">
                {formatShare(entry.count, total)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
