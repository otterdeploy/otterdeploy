/**
 * One line of a chart tooltip: swatch, series, value.
 *
 * Shared by the time-series tooltip and the table histogram's, because a
 * tooltip row is a reading convention rather than a chart's own detail — the
 * swatch has to be the same size and the value has to sit in the same place in
 * both, or comparing two charts on one screen means re-learning where to look.
 */

import { cn } from "@/shared/lib/utils";

export function TooltipRow({
  color,
  label,
  value,
  className,
}: {
  /** The series' paint, taken from the chart rather than re-derived. */
  color?: string;
  label: React.ReactNode;
  /** Already formatted: the chart knows whether it is bytes, ms or rows. */
  value: string;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center justify-between gap-4", className)}>
      <span className="flex min-w-0 items-center gap-1.5">
        <span
          aria-hidden="true"
          className="size-2 shrink-0 rounded-[2px]"
          style={{ background: color }}
        />
        <span className="truncate text-muted-foreground">{label}</span>
      </span>
      <span className="shrink-0 font-mono font-medium tabular-nums">{value}</span>
    </div>
  );
}

/** The summed line under the rows. Only honest for a stack, where the parts
 *  genuinely make up a whole. */
export function TooltipTotal({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 border-t border-border pt-1.5">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono font-medium tabular-nums">{value}</span>
    </div>
  );
}
