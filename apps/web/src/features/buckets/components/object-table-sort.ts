/**
 * Sorting and the relative-time label for the listing.
 *
 * Sorting is a rendering choice over the page the server returned — S3 lists
 * keys in one order only — so it lives with the table, not in the URL, and
 * a prefix row sorts by the scan's roll-up when there is one.
 */
import type { ObjectRow } from "../use-bucket-workbench";

export type SortKey = "name" | "size" | "modified";
export type SortDir = 1 | -1;

const DAY = 86_400_000;

/** `today`, `3d ago`, `2mo ago`, `1.5y ago` — the exact stamp goes in the title. */
export function agoLabel(modifiedMs: number | null, nowMs: number): string {
  if (modifiedMs === null) return "—";
  const days = Math.round((nowMs - modifiedMs) / DAY);
  if (days < 1) return "today";
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.round(days / 30)}mo ago`;
  return `${(days / 365).toFixed(1)}y ago`;
}

export function sortObjects(rows: readonly ObjectRow[], key: SortKey, dir: SortDir): ObjectRow[] {
  return [...rows].sort((a, b) => {
    const v =
      key === "size"
        ? a.size - b.size
        : key === "modified"
          ? (a.modifiedMs ?? 0) - (b.modifiedMs ?? 0)
          : a.key.localeCompare(b.key);
    return v * dir;
  });
}

export function sortPrefixes(
  prefixes: readonly string[],
  tallies: ReadonlyMap<string, { count: number; bytes: number }>,
  key: SortKey,
  dir: SortDir,
): string[] {
  return [...prefixes].sort((a, b) => {
    const v =
      key === "size"
        ? (tallies.get(a)?.bytes ?? 0) - (tallies.get(b)?.bytes ?? 0)
        : a.localeCompare(b);
    return v * dir;
  });
}
