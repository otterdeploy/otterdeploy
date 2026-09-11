/**
 * How an access-log row READS: the tones, the chips and the small pieces the
 * column declaration composes.
 *
 * Split from the declaration so that file stays a list of columns. The colour
 * vocabulary here is the one the old `edge-logs-constants.ts` had right — GET
 * blue, POST green, PUT/PATCH amber, DELETE red; 2xx/3xx/4xx/5xx the same four
 * — expressed as TONES rather than hard-coded Tailwind classes, so it cannot
 * drift from the badges and dots the rest of the app uses.
 */

import type { BadgeTone } from "@/shared/components/data-table/schema/types";

import { countryFlag } from "@/shared/lib/country";

/** GET reads, POST creates, PUT/PATCH change, DELETE removes — in that order
 *  of how much a mistake costs. */
export const METHOD_TONE: Record<string, BadgeTone> = {
  GET: "info",
  HEAD: "info",
  OPTIONS: "info",
  POST: "success",
  PUT: "warning",
  PATCH: "warning",
  DELETE: "danger",
};

export function methodTone(value: unknown): BadgeTone {
  return METHOD_TONE[String(value).toUpperCase()] ?? "neutral";
}

/** The status bucket a code falls in — the same four the old filter chips used. */
export function statusBucket(status: number): "2xx" | "3xx" | "4xx" | "5xx" {
  if (status >= 500) return "5xx";
  if (status >= 400) return "4xx";
  if (status >= 300) return "3xx";
  return "2xx";
}

const BUCKET_TONE: Record<string, BadgeTone> = {
  "2xx": "success",
  "3xx": "info",
  "4xx": "warning",
  "5xx": "danger",
};

export function statusTone(value: unknown): BadgeTone {
  return typeof value === "number" ? BUCKET_TONE[statusBucket(value)] : "neutral";
}

/** Histogram bands — the shared severity bands, in the same colour family as
 *  the status column's text tones. */
export const EDGE_ACCESS_STATUS_TONES: Record<string, string> = {
  "2xx": "var(--chart-band-ok)",
  "3xx": "var(--chart-band-info)",
  "4xx": "var(--chart-band-warn)",
  "5xx": "var(--chart-band-bad)",
};

/** Bottom-first: the healthy case sits under the failures. */
export const EDGE_ACCESS_STATUS_ORDER = ["2xx", "3xx", "4xx", "5xx"] as const;

/** Outline + text per tone. Tinted borders, not filled pills: five filled
 *  chips per row would make the method the loudest thing on the page. */
export const METHOD_CHIP: Record<BadgeTone, string> = {
  info: "border-info/30 text-info",
  success: "border-success/30 text-success",
  warning: "border-warning/40 text-warning",
  danger: "border-destructive/30 text-destructive",
  neutral: "border-border text-muted-foreground",
};

/** >800ms is a problem, >300ms is worth a glance — the thresholds the old
 *  access-log view used, kept so the two never disagree during the migration. */
export function LATENCY_FILL(ms: number): string {
  if (ms > 800) return "bg-destructive";
  if (ms > 300) return "bg-warning";
  return "bg-success";
}

/** A flag beside its code — never the flag alone. See `countryFlag`. */
export function CountryLabel({ code }: { code: string }) {
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
