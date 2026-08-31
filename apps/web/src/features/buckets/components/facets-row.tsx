import { formatNumber } from "@otterdeploy/shared/format";
/**
 * Facet chips: the stats scan's aggregates, each one a filter token you can
 * toggle. Clicking STANDARD_IA is exactly typing `class:STANDARD_IA` — the
 * chips are a keyboard-free editor of the same `q`, not a second filter
 * system, which is why an active chip and its token chip in the bar always
 * agree.
 *
 * Chips with a zero count are dropped rather than disabled: a facet that
 * matches nothing in the current scope is noise, not an option.
 */
import { hasStorageToken } from "@otterdeploy/shared/storage-filter";

import { cn } from "@/shared/lib/utils";

import { formatSize } from "../state";

interface Facets {
  byClass: { storageClass: string; count: number; bytes: number }[];
  byExtension: { extension: string; count: number; bytes: number }[];
  largeCount: number;
  staleCount: number;
  complete: boolean;
  scannedKeys: number;
  /** True when the numbers come from the loaded page, not the stats scan. */
  pageOnly: boolean;
}

export function FacetsRow({
  stats,
  q,
  onToggleToken,
}: {
  stats: Facets | undefined;
  q: string;
  onToggleToken: (token: string) => void;
}) {
  if (stats === undefined) return null;

  const chips: { token: string; label: string; extra: string }[] = [
    ...stats.byClass.slice(0, 4).map((c) => ({
      token: `class:${c.storageClass}`,
      label: c.storageClass,
      extra: formatSize(c.bytes),
    })),
    ...stats.byExtension.slice(0, 3).map((e) => ({
      token: `type:${e.extension}`,
      label: `.${e.extension}`,
      extra: formatNumber(e.count),
    })),
    ...(stats.largeCount > 0
      ? [{ token: "size:>100MB", label: "> 100 MB", extra: formatNumber(stats.largeCount) }]
      : []),
    ...(stats.staleCount > 0
      ? [{ token: "modified:>1y", label: "untouched 1y", extra: formatNumber(stats.staleCount) }]
      : []),
  ];

  if (chips.length === 0) return null;

  return (
    <div className="flex h-8 shrink-0 [scrollbar-width:none] items-center gap-1.5 overflow-x-auto border-b px-3 motion-safe:animate-in motion-safe:duration-200 motion-safe:fade-in-0">
      <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-[9.5px] tracking-[0.07em] text-muted-foreground uppercase">
        {stats.pageOnly
          ? "Facets · this page"
          : stats.complete
            ? "Facets"
            : `Facets · first ${formatNumber(stats.scannedKeys)} keys`}
      </span>
      {chips.map((chip) => {
        const active = hasStorageToken(q, chip.token);
        return (
          <button
            key={chip.token}
            type="button"
            aria-pressed={active}
            onClick={() => onToggleToken(chip.token)}
            className={cn(
              "flex shrink-0 items-center gap-1.5 rounded-md px-2 py-0.5 font-mono text-[11px] transition-colors",
              active
                ? "bg-primary/10 text-foreground ring-1 ring-primary/25"
                : "text-muted-foreground ring-1 ring-foreground/10 hover:bg-muted/60 hover:text-foreground",
            )}
          >
            {chip.label}
            <span className="opacity-55">{chip.extra}</span>
          </button>
        );
      })}
    </div>
  );
}
