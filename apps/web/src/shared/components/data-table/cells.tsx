/**
 * The cell vocabulary.
 *
 * Twelve tables used to make twelve decisions about what a timestamp looks
 * like, whether an id is mono, and how a status reads. These are that decision,
 * made once, against DESIGN.md:
 *
 * - **Two cuts.** Anything a person could paste into a terminal — an id, a
 *   hash, a path, an IP — is mono. Everything a person reads is sans.
 * - **State is never colour alone.** A tone always carries a dot or an icon
 *   beside its label, so a colour-blind operator reads the same table.
 * - **Numbers are tabular and trailing-aligned**, so a column of them can be
 *   compared by eye rather than by reading each one.
 * - **Nothing is invented.** A missing value renders as a dash, never as a
 *   zero, an empty string, or a guess.
 */

import { Tick02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { formatNumber } from "@otterdeploy/shared/format";
import { asInstant, asText } from "@otterdeploy/shared/table-filters";

import type { BadgeTone } from "@/shared/components/data-table/schema/types";

import { useNowMs } from "@/shared/components/data-table/use-now";
import { Badge } from "@/shared/components/ui/badge";
import { CLOCK_EXACT, clockFormatter } from "@/shared/lib/clock";
import { relativeSeconds } from "@/shared/lib/time";
import { cn } from "@/shared/lib/utils";

/** The one dash. A value we do not have is not a zero and not an empty cell. */
export function EmptyCell() {
  return (
    <span aria-label="No value" className="text-muted-foreground/60">
      –
    </span>
  );
}

const exact = clockFormatter(CLOCK_EXACT);

export function TextCell({ value }: { value: unknown }) {
  const text = asText(value);
  if (text === null || text === "") return <EmptyCell />;
  return (
    // `title` rather than a tooltip component: a table body can hold a thousand
    // of these, and a thousand mounted tooltips is a scroll-jank generator.
    <span className="block truncate" title={text}>
      {text}
    </span>
  );
}

export function CodeCell({ value }: { value: unknown }) {
  const text = asText(value);
  if (text === null || text === "") return <EmptyCell />;
  return (
    <span className="block truncate font-mono text-[13px] text-foreground/85" title={text}>
      {text}
    </span>
  );
}

export function NumberCell({ value, unit }: { value: unknown; unit?: string }) {
  if (typeof value !== "number" || !Number.isFinite(value)) return <EmptyCell />;
  return (
    <span className="block truncate text-right font-mono text-[13px] tabular-nums">
      {formatNumber(value)}
      {unit ? <span className="ml-0.5 text-muted-foreground">{unit}</span> : null}
    </span>
  );
}

/**
 * Relative time, with the exact instant one hover away.
 *
 * Relative is what an operator scanning a feed actually reads ("three minutes
 * ago" answers "is this now?"), and the absolute stamp is what they need the
 * moment they care — so both are present and neither costs a column.
 *
 * The relative half is computed against a SHARED clock that ticks, rather than
 * against the render's own `Date.now()`: a feed is left open, and a row that
 * still says "just now" twenty minutes later is misinformation, not staleness.
 */
export function InstantCell({ value }: { value: unknown }) {
  const now = useNowMs();
  const instant = asInstant(value);
  if (instant === null) return <EmptyCell />;
  return (
    <time
      dateTime={instant.toString()}
      title={exact(instant.epochMilliseconds)}
      className="block truncate text-muted-foreground tabular-nums"
    >
      {relativeSeconds((instant.epochMilliseconds - now) / 1000)}
    </time>
  );
}

const TONE_CLASS: Record<BadgeTone, string> = {
  neutral: "bg-muted text-muted-foreground",
  success: "bg-success/10 text-success",
  warning: "bg-warning/10 text-warning",
  danger: "bg-destructive/10 text-destructive",
  info: "bg-info/10 text-info",
};

const TONE_DOT: Record<BadgeTone, string> = {
  neutral: "bg-muted-foreground/60",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-destructive",
  info: "bg-info",
};

export function BadgeCell({ value, tone = "neutral" }: { value: unknown; tone?: BadgeTone }) {
  if (Array.isArray(value)) {
    const items = value.map(asText).filter((item): item is string => item !== null);
    if (items.length === 0) return <EmptyCell />;
    return (
      <span className="flex gap-1 overflow-hidden">
        {items.map((item, index) => (
          <Badge
            key={`${item}-${index}`}
            className={cn("shrink-0 border-transparent", TONE_CLASS[tone])}
          >
            {item}
          </Badge>
        ))}
      </span>
    );
  }
  const text = asText(value);
  if (text === null || text === "") return <EmptyCell />;
  return (
    <Badge className={cn("max-w-full border-transparent", TONE_CLASS[tone])}>
      <span className="truncate">{text}</span>
    </Badge>
  );
}

/**
 * State as a dot plus a word.
 *
 * The dot is not decoration: DESIGN.md requires state to survive being read
 * without colour, and a shape beside the label is what makes "denied" legible
 * to an operator who cannot tell the red from the amber.
 */
export function StateCell({ value, tone }: { value: unknown; tone: BadgeTone }) {
  const text = asText(value);
  if (text === null || text === "") return <EmptyCell />;
  return (
    <span className="flex items-center gap-1.5 truncate">
      <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", TONE_DOT[tone])} />
      <span className="truncate">{text}</span>
    </span>
  );
}

export function BooleanCell({ value }: { value: unknown }) {
  if (typeof value !== "boolean") return <EmptyCell />;
  return value ? (
    <HugeiconsIcon
      icon={Tick02Icon}
      strokeWidth={2}
      className="size-3.5 text-success"
      aria-label="Yes"
    />
  ) : (
    <EmptyCell />
  );
}

/**
 * A number beside a bar showing its share of the range.
 *
 * The bar sits beside the number it describes rather than replacing it — a bar
 * alone is a shape, and an operator comparing two rows needs the value.
 */
export function BarCell({
  value,
  min = 0,
  max = 100,
  unit,
}: {
  value: unknown;
  min?: number;
  max?: number;
  unit?: string;
}) {
  if (typeof value !== "number" || !Number.isFinite(value)) return <EmptyCell />;
  const span = max - min;
  const share = span > 0 ? Math.min(Math.max((value - min) / span, 0), 1) : 0;
  return (
    <span className="flex items-center gap-2">
      <span className="shrink-0 font-mono text-[13px] tabular-nums">
        {formatNumber(value)}
        {unit ? <span className="ml-0.5 text-muted-foreground">{unit}</span> : null}
      </span>
      <span aria-hidden className="h-1 min-w-6 flex-1 overflow-hidden rounded-full bg-foreground/8">
        <span
          className="block h-full rounded-full bg-foreground/35"
          style={{ width: `${share * 100}%` }}
        />
      </span>
    </span>
  );
}
