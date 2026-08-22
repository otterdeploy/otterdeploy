/**
 * The app's time vocabulary: "3d ago" and "29d 21h", in the operator's own
 * language.
 *
 * Before this existed there were thirteen of these, written three different
 * ways. Three surfaces (audit, docker, volumes) had already worked out the
 * right answer with `Intl.RelativeTimeFormat`; the other ten hard-coded
 * English — `${d}d ago`, `${mins}m`, "just now" — while the app ships en, de
 * and es with every other string type-checked against the bundles. A German
 * operator got a fully translated page with English durations in it.
 *
 * Even the three good ones passed `undefined` as the locale, which is the
 * BROWSER's language, not the app's. Someone who sets otterdeploy to German
 * on an English machine still read English. Locale here comes from the i18n
 * instance, so the choice the operator actually made is the one that wins.
 *
 * Both formatters are cached per locale. Constructing an Intl formatter is
 * the expensive part and these run per row, per render, on tables of hundreds.
 */
import { i18n } from "@otterdeploy/i18n/web";

/** Largest-first, so the first unit the span reaches is the one it reads in. */
const RELATIVE_UNITS: ReadonlyArray<readonly [Intl.RelativeTimeFormatUnit, number]> = [
  ["year", 60 * 60 * 24 * 365],
  ["month", 60 * 60 * 24 * 30],
  ["day", 60 * 60 * 24],
  ["hour", 60 * 60],
  ["minute", 60],
  ["second", 1],
];

/**
 * The language the operator picked, not the one their browser was installed
 * with. Falls back to `undefined` (runtime default) before i18n has resolved,
 * which only happens on the very first paint.
 */
function activeLocale(): string | undefined {
  return i18n.resolvedLanguage ?? i18n.language ?? undefined;
}

const relativeFormatters = new Map<string, Intl.RelativeTimeFormat>();
const durationFormatters = new Map<string, Intl.DurationFormat>();

function relativeFormatter(): Intl.RelativeTimeFormat {
  const locale = activeLocale();
  const key = locale ?? "";
  const cached = relativeFormatters.get(key);
  if (cached) return cached;
  // `numeric: "auto"` is what turns "1 day ago" into "yesterday" where the
  // language has a word for it, which is the whole point of doing this in Intl
  // rather than with a template string.
  const made = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  relativeFormatters.set(key, made);
  return made;
}

function durationFormatter(): Intl.DurationFormat {
  const locale = activeLocale();
  const key = locale ?? "";
  const cached = durationFormatters.get(key);
  if (cached) return cached;
  // "narrow" is the register these surfaces already speak: `29d 21h`, not
  // "29 days, 21 hours". In English it is byte-identical to what the
  // hand-rolled versions produced.
  const made = new Intl.DurationFormat(locale, { style: "narrow" });
  durationFormatters.set(key, made);
  return made;
}

/**
 * A signed offset in seconds as relative time: negative is past ("3d ago"),
 * positive is future ("in 3d").
 *
 * Callers own their own guards. A non-finite value is the caller's to reject,
 * because "the daemon sent us garbage" and "this happened just now" are
 * different facts and only the caller knows which sentinel its surface uses.
 */
export function relativeSeconds(diffSeconds: number): string {
  const formatter = relativeFormatter();
  const abs = Math.abs(diffSeconds);
  for (const [unit, secs] of RELATIVE_UNITS) {
    if (abs >= secs || unit === "second") {
      return formatter.format(Math.round(diffSeconds / secs), unit);
    }
  }
  return formatter.format(0, "second");
}

/** Relative time from an epoch-milliseconds instant. */
export function relativeMs(ms: number): string {
  return relativeSeconds((ms - Date.now()) / 1000);
}

/**
 * A span of seconds as its two most significant units: "29d 21h", "19h 1m",
 * "42m", "<1m".
 *
 * Two units, not one, because "29d" alone loses most of a day and
 * "29d 21h 30m 27s" is not read, it is skipped. Callers own their own edge
 * cases — this only formats a positive span, so "expired" vs "just started"
 * vs "we don't know" stays each surface's decision rather than being smuggled
 * in here as a magic string.
 */
export function humanizeSeconds(seconds: number): string {
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const formatter = durationFormatter();
  if (days > 0) return formatter.format(hours > 0 ? { days, hours } : { days });
  if (hours > 0) return formatter.format(mins > 0 ? { hours, minutes: mins } : { hours });
  if (mins > 0) return formatter.format({ minutes: mins });
  // Sub-minute. "0m" would read as a stopped clock, and the exact seconds are
  // noise at this end of the scale.
  return `<${formatter.format({ minutes: 1 })}`;
}

/** Compact relative time from an ISO string, for surfaces that hand us one. */
export function timeAgo(iso: string): string {
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? iso : relativeMs(ms);
}
