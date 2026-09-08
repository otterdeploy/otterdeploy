/**
 * The live tail's controls and the dimming it drives.
 *
 * Tailing and a fixed time window are contradictory instructions, so this file
 * owns the one rule that keeps them from being half-applied: turning the tail
 * on clears the window, in the same write.
 */

import { useCallback } from "react";

import { tailRowClassName } from "@/shared/components/data-table/feed/use-live-tail";
import { useFilterActions } from "@/shared/components/data-table/state/store";
import { Button } from "@/shared/components/ui/button";
import { cn } from "@/shared/lib/utils";

/**
 * Should the tail be running?
 *
 * Live is on AND no time window is set. A window is a fixed upper bound, so
 * running a tail inside one produces a table that claims to be live and never
 * changes.
 */
export function isTailing(values: Record<string, unknown>, timeKey: string | undefined): boolean {
  if (values.live !== true) return false;
  if (!timeKey) return true;
  const window = values[timeKey];
  return !(Array.isArray(window) && window.length > 0);
}

/** A row's time, for the tail's dimming. */
function readTime(row: unknown, key: string): number | null {
  if (typeof row !== "object" || row === null || !Object.hasOwn(row, key)) return null;
  const value: unknown = Reflect.get(row, key);
  if (typeof value === "number") return value;
  if (value instanceof Date) return value.getTime();
  return null;
}

/**
 * A row's own class, plus the tail's dimming.
 *
 * Combined into ONE callback so the row memo sees a single stable identity that
 * changes exactly when the dimming should — two callbacks would re-render every
 * row whenever either changed.
 */
export function useTailedRowClassName<TRow>(params: {
  rowClassName?: (row: TRow) => string | undefined;
  timeKey: string | undefined;
  since: number | undefined;
}): (row: TRow) => string | undefined {
  const { rowClassName, timeKey, since } = params;
  return useCallback(
    (row: TRow) => {
      const own = rowClassName?.(row);
      if (!timeKey || since === undefined) return own;
      const at = readTime(row, timeKey);
      const dim = at === null ? undefined : tailRowClassName(since, at);
      return [own, dim].filter(Boolean).join(" ") || undefined;
    },
    [rowClassName, timeKey, since],
  );
}

/**
 * The tail toggle.
 *
 * The dot pulses only while the tail is running, and holds still under
 * `prefers-reduced-motion` — a live indicator is exactly the kind of persistent
 * animation that rule exists for.
 */
export function LiveToggle({ isLive, timeKey }: { isLive: boolean; timeKey: string | undefined }) {
  const { setValues } = useFilterActions();
  return (
    <Button
      variant="ghost"
      size="sm"
      aria-pressed={isLive}
      onClick={() =>
        setValues({ live: isLive ? undefined : true, ...(timeKey ? { [timeKey]: undefined } : {}) })
      }
      className={cn("h-8 gap-1.5", isLive && "text-info")}
    >
      <span
        aria-hidden
        className={cn(
          "size-1.5 rounded-full",
          isLive ? "animate-pulse bg-info motion-reduce:animate-none" : "bg-muted-foreground/50",
        )}
      />
      Live
    </Button>
  );
}
