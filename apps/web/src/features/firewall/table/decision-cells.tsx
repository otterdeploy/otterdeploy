/**
 * How a firewall decision READS.
 *
 * Split from the column declaration so that file stays a list of columns. The
 * tones are the shared five, so a `ban` here and a `danger` badge anywhere else
 * in the app are the same red.
 */

import type { BadgeTone } from "@/shared/components/data-table/schema/types";

import { useNowMs } from "@/shared/components/data-table/use-now";
import { countryFlag } from "@/shared/lib/country";
import { humanizeSeconds, relativeMs } from "@/shared/lib/time";
import { cn } from "@/shared/lib/utils";

/** One decision, as the persisted `firewall_decision` row sends it. */
export interface FirewallDecisionRow {
  id: string;
  /** CrowdSec's own id. Null for rows recorded from a `cscli` snapshot. */
  lapiId: number | null;
  /** The blocked IP or CIDR. */
  value: string;
  /** `Ip` or `Range`, as CrowdSec spells it. */
  scope: string;
  /** `ban`, `captcha`, `throttle`. */
  type: string;
  /** What triggered it — a scenario, a blocklist name, or a manual reason. */
  scenario: string;
  /** `crowdsec`, `CAPI`, `lists`, `cscli`. */
  origin: string;
  /** As CrowdSec reported it (`4h`, `168h`). Verbatim, not parsed. */
  duration: string | null;
  country: string | null;
  asNumber: string | null;
  asName: string | null;
  eventsCount: number | null;
  /** First poll that saw this decision — the row's place in the feed. */
  firstSeenAt: string;
  /** Last poll that still saw it. */
  lastSeenAt: string;
  /** When it stopped being enforced. Null = still live. */
  endedAt: string | null;
  /**
   * When it is due to lapse — CrowdSec's `until`.
   *
   * Sent rather than derived from `duration`: the duration is kept verbatim as
   * the engine spelled it ("168h"), and re-deriving an instant from a string
   * the engine is free to reword is how a countdown starts lying.
   */
  expiresAt: string | null;
  /**
   * `active` | `expired`, computed by the feed.
   *
   * On the row rather than derived per render, because it is a FILTER key: the
   * server compiles it from a SQL expression and the client evaluator reads it
   * off the row, and the two only agree if the value travels.
   */
  state: string;
}

/** Live or finished. The one thing a reader checks before anything else. */
export function decisionState(row: FirewallDecisionRow): "active" | "expired" {
  return row.endedAt === null ? "active" : "expired";
}

/**
 * An enforced decision is the loud one.
 *
 * Deliberately NOT "expired = success": nothing succeeded, the ban simply ran
 * out. Expired is the quiet, ordinary state, so it takes the neutral tone and
 * lets the live rows carry the only colour in the column.
 */
function stateTone(value: unknown): BadgeTone {
  return value === "active" ? "danger" : "neutral";
}

/**
 * What KIND of enforcement. A ban drops the packet; a captcha lets a human
 * through; a throttle only slows one down — descending severity, and the tones
 * say so.
 */
const TYPE_TONE: Record<string, BadgeTone> = {
  ban: "danger",
  captcha: "warning",
  throttle: "info",
};

function decisionTypeTone(value: unknown): BadgeTone {
  return TYPE_TONE[String(value).toLowerCase()] ?? "neutral";
}

/**
 * WHO decided, which is the difference between noise and an attack.
 *
 * `crowdsec` means a local scenario fired on traffic that reached THIS install
 * — someone is probing you. `CAPI` and `lists` are the community feed arriving
 * in bulk, which says nothing about you at all. `cscli` is a human. Reading a
 * spike without that split is how a blocklist sync gets mistaken for an
 * incident.
 */
const ORIGIN_TONE: Record<string, BadgeTone> = {
  crowdsec: "danger",
  cscli: "warning",
  capi: "info",
  lists: "neutral",
};

export function decisionOriginTone(value: unknown): BadgeTone {
  return ORIGIN_TONE[String(value).toLowerCase()] ?? "neutral";
}

/** Histogram bands, by origin — see `decisionOriginTone` for why that axis. */
export const FIREWALL_ORIGIN_TONES: Record<string, string> = {
  crowdsec: "var(--chart-band-bad)",
  cscli: "var(--chart-band-warn)",
  CAPI: "var(--chart-band-info)",
  lists: "var(--chart-2)",
};

/** Bottom-first: the bulk community feed sits under the decisions about you. */
export const FIREWALL_ORIGIN_ORDER = ["lists", "CAPI", "cscli", "crowdsec"] as const;

/** The outlined chip the method and level columns use, so the three read alike. */
const DECISION_CHIP: Record<BadgeTone, string> = {
  info: "border-info/30 text-info",
  success: "border-success/30 text-success",
  warning: "border-warning/40 text-warning",
  danger: "border-destructive/30 text-destructive",
  neutral: "border-border text-muted-foreground",
};

export function DecisionChip({ value, tone }: { value: string; tone: BadgeTone }) {
  return (
    <span
      className={cn(
        // No `uppercase`: `crowdsec`, `cscli` and `ban` are literal values, and
        // shouting them makes the table look like it is quoting constants it
        // is not. `CAPI` already arrives uppercase because it genuinely is.
        "inline-flex items-center rounded-[4px] border px-1.5 py-px font-mono text-[10px] font-semibold tracking-wide",
        DECISION_CHIP[tone],
      )}
    >
      {value}
    </span>
  );
}

/**
 * What is happening to this address, in one cell.
 *
 * The reference view folds three facts together — state, kind, and how long is
 * left — and it is right to: they are one sentence ("banned, 25d 23h to go"),
 * and split across three columns a reader has to reassemble it every row. The
 * dot carries the state so it survives being read without colour.
 *
 * The remaining time TICKS, against the table's shared clock, because a ban
 * with four minutes left is a different decision from one with four hours and
 * a stale number hides the difference.
 */
export function DecisionStatus({ row }: { row: FirewallDecisionRow }) {
  const now = useNowMs();
  const state = decisionState(row);
  const tone = stateTone(state);
  return (
    <span className="flex items-center gap-1.5 truncate">
      <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", TONE_DOT[tone])} />
      <span className="font-mono text-[12px]">{row.type}</span>
      <span aria-hidden className="text-muted-foreground/40">
        ·
      </span>
      <span className="truncate font-mono text-[12px] text-muted-foreground tabular-nums">
        {remainingLabel(row, state, now)}
      </span>
    </span>
  );
}

/** Dot colours, matching the shared tones. */
const TONE_DOT: Record<BadgeTone, string> = {
  neutral: "bg-muted-foreground/60",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-destructive",
  info: "bg-info",
};

/**
 * "25d 23h" while it runs, "expired 2h ago" once it has.
 *
 * Both are the same question asked from different sides, and an operator wants
 * whichever one applies — a live ban's remaining time is what decides whether
 * to wait it out, and a lapsed one's age is what decides whether it explains
 * the report you are reading.
 */
function remainingLabel(row: FirewallDecisionRow, state: string, now: number): string {
  if (state === "expired") {
    const ended = row.endedAt === null ? null : Date.parse(row.endedAt);
    return ended === null ? "expired" : `expired ${relativeMs(now - ended)}`;
  }
  if (row.expiresAt === null) return "no end";
  const left = Math.floor((Date.parse(row.expiresAt) - now) / 1000);
  // Past its expiry but not yet observed gone: the poller has not caught up.
  // "lapsing" is the honest word for it — neither still enforced nor confirmed
  // lifted, and claiming either would be a guess.
  if (left <= 0) return "lapsing";
  if (left >= PERMANENT_SECONDS) return "permanent";
  return humanizeSeconds(left);
}

/** Past this much left, the operator chose "forever" — see `duration.ts`. */
const PERMANENT_SECONDS = 10 * 365 * 86_400;

/** A flag beside its code — never the flag alone. See `countryFlag`. */
export function DecisionCountry({ code }: { code: string }) {
  const flag = countryFlag(code);
  return (
    <span className="flex items-center gap-1.5 truncate font-mono text-[12px]">
      {flag ? (
        <span aria-hidden className="text-[13px] leading-none">
          {flag}
        </span>
      ) : null}
      <span className="truncate">{code}</span>
    </span>
  );
}
