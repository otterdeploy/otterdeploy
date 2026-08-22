/**
 * A percentage as a number AND a proportional bar AND a threshold colour.
 *
 * Distinct from `Progress`, which reports how far along a task is in the accent
 * colour. A meter reports how much headroom is left, and its colour is a
 * judgement about that: a disk at 94% has to be visibly not a disk at 12%
 * before the reader has parsed either digit.
 *
 * Colour is never the only signal. The bar always sits beside the number it
 * describes, and `label` names the thing being measured — DESIGN.md's rule that
 * state never depends on colour alone, applied to data rather than to chrome.
 */

import type { MeterState, Thresholds } from "@otterdeploy/shared/thresholds";

import { meterState } from "@otterdeploy/shared/thresholds";

import { cn } from "@/shared/lib/utils";

/** Same three states everywhere: the servers list, the health card, the unit
 *  table. Tints follow the State-Tint Rule — the hue's own low-opacity fill,
 *  not a saturated block. */
const FILL: Record<MeterState, string> = {
  good: "bg-success",
  warn: "bg-warning",
  crit: "bg-destructive",
};

const TEXT: Record<MeterState, string> = {
  good: "text-foreground",
  warn: "text-warning",
  crit: "text-destructive",
};

interface MeterProps {
  /** 0–100. Values above 100 clamp the bar but keep the printed number honest
   *  (Docker-style CPU legitimately exceeds 100% on a multi-core host). */
  value: number;
  /** Names what is measured; read by assistive tech alongside the value. */
  label: string;
  thresholds?: Thresholds;
  /** Renders the number to the left of the bar. Off for a bare inline bar. */
  showValue?: boolean;
  /** Formats the printed number. Defaults to one decimal under 10, none over. */
  format?: (value: number) => string;
  className?: string;
}

function defaultFormat(value: number): string {
  return `${value >= 10 ? Math.round(value) : Math.round(value * 10) / 10}%`;
}

export function Meter({
  value,
  label,
  thresholds,
  showValue = true,
  format = defaultFormat,
  className,
}: MeterProps) {
  const state = meterState(value, thresholds);
  const width = Math.min(100, Math.max(0, value));

  return (
    <div
      className={cn("flex min-w-0 items-center gap-2", className)}
      role="meter"
      aria-label={label}
      aria-valuenow={Math.round(value)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuetext={`${label}: ${format(value)}`}
    >
      {showValue && (
        <span className={cn("min-w-10 shrink-0 font-mono text-xs tabular-nums", TEXT[state])}>
          {format(value)}
        </span>
      )}
      <span className="h-[0.8em] min-w-8 flex-1 overflow-hidden rounded-[3px] bg-muted">
        <span className={cn("block h-full", FILL[state])} style={{ width: `${width}%` }} />
      </span>
    </div>
  );
}

/**
 * The dot form, for a table cell too narrow for a bar or a status that has no
 * magnitude. Always rendered next to its own label by the caller.
 */
export function MeterDot({
  value,
  thresholds,
  className,
}: {
  value: number;
  thresholds?: Thresholds;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-block size-2 shrink-0 rounded-full",
        FILL[meterState(value, thresholds)],
        className,
      )}
    />
  );
}
