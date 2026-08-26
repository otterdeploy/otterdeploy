/**
 * "Being read right now": the live paths with their visitor counts, shared
 * by the Realtime view and the overview's realtime teaser. The empty line is
 * the caller's, because the two surfaces phrase it differently.
 */

import { formatCount } from "../../analytics-model";

export interface TopPathEntry {
  path: string;
  visitors: number;
}

export function TopPathsList({
  entries,
  empty,
}: {
  entries: readonly TopPathEntry[];
  empty: string;
}) {
  if (entries.length === 0) {
    return <p className="py-1 text-xs text-muted-foreground">{empty}</p>;
  }
  return (
    <ul className="flex flex-col">
      {entries.map((entry) => (
        <li key={entry.path} className="flex items-center gap-2 py-1">
          <span className="min-w-0 flex-1 truncate font-mono text-xs" title={entry.path}>
            {entry.path}
          </span>
          <span className="font-mono text-xs text-muted-foreground tabular-nums">
            {formatCount(entry.visitors)}
          </span>
        </li>
      ))}
    </ul>
  );
}
