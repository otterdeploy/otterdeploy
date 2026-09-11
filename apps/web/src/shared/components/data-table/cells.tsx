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
import { CLOCK_DAY, CLOCK_EXACT, CLOCK_SECONDS, utcFormatter } from "@/shared/lib/clock";
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

const exact = utcFormatter({ ...CLOCK_EXACT, timeZoneName: "short" });

/**
 * One format, every row: the date, then the clock, to the second.
 *
 * Two earlier versions of this were conditional, and both were wrong in the
 * same way. First the seconds were dropped on older days to stop the cell
 * clipping, so `00:16:52` was followed by `Sep 8, 23:09` and precision changed
 * halfway down the column. Then the DATE was conditional — present only on
 * rows that were not from today — which left the column ragged: half the cells
 * started with a month and half with a digit, so nothing lined up, and reading
 * it required knowing that a missing date meant "today".
 *
 * Both were paying for the same thing: the column is sized for the long form
 * either way (see {@link CLOCK_WIDTH}), so omitting the date bought no width.
 * It only bought a convention the reader had to be taught.
 */
const clock = utcFormatter({ ...CLOCK_DAY, ...CLOCK_SECONDS });

/**
 * What a clock column has to be wide enough for.
 *
 * Measured, not guessed: the date part is locale-formatted, so en-US's
 * "Nov 30, 22:33:08" is "30. Nov., 22:33:08" in German — 132px of Geist Mono at
 * 12px, plus the cell's 16px of padding. 152 clears the worst of en / de / es.
 *
 * Declared once so the feeds cannot drift to five different widths.
 */
export const CLOCK_WIDTH = 152;

/**
 * A wall clock, for feeds whose rows arrive seconds apart.
 *
 * `InstantCell`'s relative form is right when rows are minutes or hours apart —
 * "3m ago" is what an audit reader wants. It is useless on an access log, where
 * twenty consecutive rows all read "43 seconds ago" and none of them can be
 * lined up against an alert, a deploy, or another log.
 *
 * Pure, and deliberately so. The old conditional format had to know what day it
 * is, which meant every clock cell in every feed subscribed to the shared tick
 * and re-rendered on it — to answer a question whose answer changes once a day.
 */
export function ClockCell({ value }: { value: unknown }) {
  const at = asInstant(value);
  if (at === null) return <EmptyCell />;
  return (
    <time
      dateTime={at.toString()}
      title={exact(at)}
      className="block truncate font-mono text-[12px] text-muted-foreground tabular-nums"
    >
      {clock(at)}
    </time>
  );
}

/**
 * `wrap` is the detail sheet's setting, and only its setting.
 *
 * A grid row has a fixed height, so a long value there truncates and keeps its
 * full text on `title`. The sheet has no such constraint and exists precisely
 * to show the whole value — truncating a message there, under a panel whose
 * whole promise is the complete record, is the panel failing at its one job.
 */
export function TextCell({ value, wrap = false }: { value: unknown; wrap?: boolean }) {
  const text = asText(value);
  if (text === null || text === "") return <EmptyCell />;
  return (
    // `title` rather than a tooltip component: a table body can hold a thousand
    // of these, and a thousand mounted tooltips is a scroll-jank generator.
    <span className={cn("block", wrap ? "break-words" : "truncate")} title={text}>
      {text}
    </span>
  );
}

/**
 * Mono text, optionally tinted.
 *
 * The tint is for values whose CLASS is the point — an HTTP method, a status
 * code, a log level written as a word. It reuses the same five tones as badges
 * and dots, so `DELETE` and a `danger` pill are the same red everywhere, and a
 * surface cannot quietly introduce a sixth vocabulary.
 */
export function CodeCell({
  value,
  tone,
  wrap = false,
}: {
  value: unknown;
  tone?: BadgeTone;
  /** See {@link TextCell}. */
  wrap?: boolean;
}) {
  const text = asText(value);
  if (text === null || text === "") return <EmptyCell />;
  return (
    <span
      className={cn(
        "block font-mono text-[12px]",
        wrap ? "break-all" : "truncate",
        tone ? TONE_TEXT[tone] : "text-foreground/85",
      )}
      title={text}
    >
      {text}
    </span>
  );
}

export function NumberCell({ value, unit }: { value: unknown; unit?: string }) {
  if (typeof value !== "number" || !Number.isFinite(value)) return <EmptyCell />;
  return (
    <span className="block truncate text-right font-mono text-[12px] tabular-nums">
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

/** Text-only tones, for a value that is its own label. No surface, no dot. */
const TONE_TEXT: Record<BadgeTone, string> = {
  neutral: "text-foreground/85",
  success: "text-success",
  warning: "text-warning",
  danger: "text-destructive",
  info: "text-info",
};

const TONE_DOT: Record<BadgeTone, string> = {
  neutral: "bg-muted-foreground/60",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-destructive",
  info: "bg-info",
};

export function BadgeCell({
  value,
  tone = "neutral",
  wrap = false,
}: {
  value: unknown;
  tone?: BadgeTone;
  /**
   * Let a list run onto a second line.
   *
   * Off in a grid row, whose height is fixed — a wrapping cell would push its
   * neighbours out of alignment. On in the detail sheet, where clipping the
   * third of three values is how a panel that exists to show the whole record
   * quietly stops showing it.
   */
  wrap?: boolean;
}) {
  if (Array.isArray(value)) {
    const items = value.map(asText).filter((item): item is string => item !== null);
    if (items.length === 0) return <EmptyCell />;
    return (
      <span className={cn("flex gap-1", wrap ? "flex-wrap" : "overflow-hidden")}>
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
      <span className="shrink-0 font-mono text-[12px] tabular-nums">
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
