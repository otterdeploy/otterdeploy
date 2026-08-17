/**
 * Pure view-model helpers for the Analytics surface: wire shapes → chart rows,
 * status grouping, and the formatters the panels share. Kept free of React so
 * the interesting logic is table-testable.
 */

export const ANALYTICS_RANGES = ["24h", "7d", "30d", "90d"] as const;
export type AnalyticsRangeKey = (typeof ANALYTICS_RANGES)[number];

/** One overview series bucket as the API ships it. */
export interface WireSeriesBucket {
  t: string;
  requests: number;
  botRequests: number;
  s2xx: number;
  s3xx: number;
  s4xx: number;
  s5xx: number;
  sOther: number;
  resBytes: number;
  p50: number | null;
  p95: number | null;
  p99: number | null;
}

export interface RequestRow {
  ts: number;
  requests: number;
  errors: number;
}

export interface LatencyRow {
  ts: number;
  p50: number | null;
  p95: number | null;
  p99: number | null;
}

/** Requests + errors per bucket. Errors overlay the total (4xx+5xx ⊆ all),
 *  which reads as a shaded floor under the traffic line: one axis, one unit. */
export function requestRows(series: readonly WireSeriesBucket[]): RequestRow[] {
  return series.map((b) => ({
    ts: Date.parse(b.t),
    requests: b.requests,
    errors: b.s4xx + b.s5xx,
  }));
}

export function latencyRows(series: readonly WireSeriesBucket[]): LatencyRow[] {
  return series.map((b) => ({ ts: Date.parse(b.t), p50: b.p50, p95: b.p95, p99: b.p99 }));
}

export interface TopEntry {
  key: string;
  count: number;
}

export type StatusClassKey = "2xx" | "3xx" | "4xx" | "5xx" | "other";

export interface StatusClassGroup {
  cls: StatusClassKey;
  total: number;
  codes: TopEntry[];
}

const CLASS_ORDER: readonly StatusClassKey[] = ["2xx", "3xx", "4xx", "5xx", "other"];

function classOfCode(code: string): StatusClassKey {
  const n = Number(code);
  if (n >= 200 && n < 300) return "2xx";
  if (n >= 300 && n < 400) return "3xx";
  if (n >= 400 && n < 500) return "4xx";
  if (n >= 500 && n < 600) return "5xx";
  // "0" (client gone before a response) and anything out of range: counted,
  // shown apart, so the four class shares still add up.
  return "other";
}

/** Group exact status codes into ordered classes, codes ranked by count.
 *  Empty classes are dropped: an all-2xx day shouldn't render four rows. */
export function groupStatuses(entries: readonly TopEntry[]): StatusClassGroup[] {
  const byClass = new Map<StatusClassKey, TopEntry[]>();
  for (const entry of entries) {
    const cls = classOfCode(entry.key);
    const list = byClass.get(cls);
    if (list) list.push(entry);
    else byClass.set(cls, [entry]);
  }
  const groups: StatusClassGroup[] = [];
  for (const cls of CLASS_ORDER) {
    const codes = byClass.get(cls);
    if (!codes || codes.length === 0) continue;
    codes.sort((a, b) => b.count - a.count);
    groups.push({ cls, total: codes.reduce((s, c) => s + c.count, 0), codes });
  }
  return groups;
}

/** 12_400 → "12.4K", 950 → "950", 3_200_000 → "3.2M". Analytics counts are
 *  read for magnitude; exact figures live in tooltips and tables. */
export function formatCount(n: number): string {
  if (n < 1_000) return String(n);
  if (n < 1_000_000) return `${trimTrailingZero((n / 1_000).toFixed(1))}K`;
  if (n < 1_000_000_000) return `${trimTrailingZero((n / 1_000_000).toFixed(1))}M`;
  return `${trimTrailingZero((n / 1_000_000_000).toFixed(1))}B`;
}

function trimTrailingZero(s: string): string {
  return s.endsWith(".0") ? s.slice(0, -2) : s;
}

/** Share of a total as a display percent: sub-0.1% traffic still reads as
 *  "<0.1%" rather than a lying "0.0%". */
export function formatShare(count: number, total: number): string {
  if (total <= 0) return "0%";
  const pct = (count / total) * 100;
  if (pct > 0 && pct < 0.1) return "<0.1%";
  return `${pct.toFixed(1)}%`;
}

const countryNames = new Intl.DisplayNames(["en"], { type: "region" });

/** "DE" → "Germany"; an unknown code renders as itself, never throws. */
export function countryName(code: string): string {
  if (!/^[A-Z]{2}$/.test(code)) return code;
  try {
    return countryNames.of(code) ?? code;
  } catch {
    return code;
  }
}
