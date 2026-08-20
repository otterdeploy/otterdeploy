import { useState } from "react";

import { cn } from "@/shared/lib/utils";

/** Time windows shared by both the access-log and event views. */
export const RANGES = ["5m", "1h", "6h", "24h", "7d"] as const;
export type Range = (typeof RANGES)[number];

/** Sticky union of every host observed across renders, sorted. Filtered query
 *  results only cover the hosts the CURRENT filters matched, so deriving the
 *  dropdown options from them directly makes every other host vanish (and
 *  flash back) the moment one is checked. Merging monotonically keeps the
 *  option list stable for the life of the view. */
export function useStickyHostOptions(observed: string[]): string[] {
  const [options, setOptions] = useState<string[]>([]);
  // Merged DURING RENDER (React's "adjusting state" pattern, same idiom as
  // the wizard's filter-key reset), never in an effect: an effect that only
  // feeds state back into state is a cascading render, and it paints one
  // frame with the stale option list before correcting itself. The merge is
  // monotonic, so re-running it under StrictMode's double invoke is a no-op.
  const merged = new Set(options);
  for (const host of observed) merged.add(host);
  // Same size ⇒ nothing new (merges only ever grow), so keep the identity.
  const next = merged.size === options.length ? options : [...merged].sort();
  if (next !== options) setOptions(next);
  return next;
}

/** Toggle membership of `v` in a string set, returning a fresh set. */
export function toggleSet(set: Set<string>, v: string): Set<string> {
  const next = new Set(set);
  if (next.has(v)) next.delete(v);
  else next.add(v);
  return next;
}

/** The live/paused tail status badge shown in each view header. */
export function LiveBadge({ live }: { live: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-[11px]",
        live ? "text-success" : "text-muted-foreground",
      )}
    >
      <span
        className={cn(
          "size-1.5 rounded-full",
          live ? "animate-pulse bg-success" : "bg-muted-foreground",
        )}
      />
      {live ? "live tail" : "paused"}
    </span>
  );
}

/** Multi-select filter chips. Empty selection = no filter (all shown, chips
 *  dimmed); selecting any narrows to those, OR-combined. */
export function Chips({
  options,
  selected,
  onToggle,
  colors,
}: {
  options: readonly string[];
  selected: Set<string>;
  onToggle: (v: string) => void;
  colors: Record<string, string>;
}) {
  const none = selected.size === 0;
  return (
    <div className="flex items-center gap-0.5 rounded-md border p-0.5">
      {options.map((o) => {
        const active = selected.has(o);
        return (
          <button
            key={o}
            type="button"
            onClick={() => onToggle(o)}
            className={cn(
              "rounded px-2 py-1 text-[11px] font-medium transition-all",
              colors[o],
              active && "bg-muted",
              !active && !none && "opacity-40 hover:opacity-100",
              !active && none && "opacity-80 hover:opacity-100",
            )}
          >
            {o}
          </button>
        );
      })}
    </div>
  );
}

export function Segmented({
  options,
  value,
  onChange,
  colors,
}: {
  options: readonly string[];
  value: string | null;
  onChange: (v: string) => void;
  /** Optional per-option text color (matches the design's tinted filters). */
  colors?: Record<string, string>;
}) {
  return (
    <div className="flex items-center gap-0.5 rounded-md border p-0.5">
      {options.map((o) => {
        const active = value === o;
        return (
          <button
            key={o}
            type="button"
            onClick={() => onChange(o)}
            className={cn(
              "rounded px-2 py-1 text-[11px] font-medium transition-colors",
              colors?.[o] ?? (active ? "text-foreground" : "text-muted-foreground"),
              active ? "bg-muted" : "hover:bg-muted/60",
              !colors && !active && "hover:text-foreground",
            )}
          >
            {o}
          </button>
        );
      })}
    </div>
  );
}

export function Detail({
  k,
  v,
  wide,
  wrap,
  vClass,
}: {
  k: string;
  v: string;
  wide?: boolean;
  wrap?: boolean;
  /** Optional tint for the value (e.g. cache HIT/BYPASS status colors). */
  vClass?: string;
}) {
  return (
    // min-w-0: without it this flex item (and grid cell) keeps its intrinsic
    // content width, so a long value (user-agent, referer) overflows instead of
    // truncating. With it, the value span can shrink and truncate/wrap kicks in.
    <div className={cn("flex min-w-0 gap-2", wide && "col-span-2")}>
      <span className="shrink-0 text-muted-foreground">{k}</span>
      <span className={cn("min-w-0 text-foreground/90", wrap ? "break-all" : "truncate", vClass)}>
        {v}
      </span>
    </div>
  );
}
