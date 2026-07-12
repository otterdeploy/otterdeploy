import { orpc } from "@/shared/server/orpc";

export type EdgeLogsData = Awaited<ReturnType<typeof orpc.edgeLogs.query.call>>;
export type EdgeLog = EdgeLogsData["rows"][number];

export const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
export const BUCKETS = ["2xx", "3xx", "4xx", "5xx"] as const;
export type Bucket = (typeof BUCKETS)[number];

export const BUCKET_BG: Record<Bucket, string> = {
  "2xx": "bg-success",
  "3xx": "bg-sky-500",
  "4xx": "bg-amber-500",
  "5xx": "bg-destructive",
};
export const BUCKET_TEXT: Record<Bucket, string> = {
  "2xx": "text-success",
  "3xx": "text-sky-500",
  "4xx": "text-amber-500",
  "5xx": "text-destructive",
};
export const METHOD_TEXT: Record<string, string> = {
  GET: "text-sky-500",
  POST: "text-success",
  PUT: "text-amber-500",
  PATCH: "text-amber-500",
  DELETE: "text-destructive",
};

export function statusBucket(s: number): Bucket {
  if (s >= 500) return "5xx";
  if (s >= 400) return "4xx";
  if (s >= 300) return "3xx";
  return "2xx";
}

/** Fill class for the inline latency mini-bar — demo thresholds: >800ms is a
 *  problem, >300ms is worth a glance, anything faster reads as healthy. */
export function latencyBarClass(ms: number): string {
  if (ms > 800) return "bg-destructive";
  if (ms > 300) return "bg-amber-500";
  return "bg-success";
}

/** Bar length as a % of a 1s full scale (matches the demo's proportion). */
export function latencyBarPct(ms: number): number {
  return Math.min(100, Math.max(0, (ms / 1000) * 100));
}

/** Tint for the cache status in the expanded grid: HIT reads ok, BYPASS (and
 *  stale-ish states) warn, MISS stays neutral. */
export function cacheTextClass(cache: string | null): string | undefined {
  const c = cache?.toUpperCase();
  if (c === "HIT") return "text-success";
  if (c === "BYPASS" || c === "EXPIRED" || c === "STALE") return "text-amber-500";
  return undefined;
}

/** Footer err% tint — two tiers per the demo: ≥2% red, ≥0.5% amber.
 *  `rate` is a fraction (0.02 = 2%). */
export function errRateClass(rate: number): string | undefined {
  if (rate >= 0.02) return "text-destructive";
  if (rate >= 0.005) return "text-amber-500";
  return undefined;
}
