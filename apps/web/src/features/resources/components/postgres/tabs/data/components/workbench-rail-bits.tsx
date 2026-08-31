/**
 * Small pieces the rail renders but does not think about: the loading
 * skeleton and the compact row-count formatter. Split out purely to keep the
 * rail itself readable in one screen.
 */
const COMPACT_COUNT_FORMAT = new Intl.NumberFormat("en", {
  notation: "compact",
  maximumFractionDigits: 1,
});

/** 1234 → "1.2K": the rail is narrow, and the estimate is approximate anyway. */
export function compactCount(n: number): string {
  return COMPACT_COUNT_FORMAT.format(n);
}

export function SidebarSkeleton() {
  return (
    <div className="flex flex-col gap-1 px-1.5 py-1">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="h-5 animate-pulse rounded bg-muted/60" />
      ))}
    </div>
  );
}
