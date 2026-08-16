/**
 * Pure normalization helpers for the analytics accumulator. Everything here
 * runs once per ingested request line, so every regex is precompiled at module
 * scope and every function is allocation-light.
 */

import { LATENCY_BUCKET_BOUNDS_MS, LATENCY_BUCKET_COUNT } from "@otterdeploy/db/schema/edge-stat";

/** Longest path key persisted; longer paths are truncated, keeping rollup keys
 *  bounded no matter what a scanner sends. */
export const PATH_KEY_MAX_LENGTH = 120;

const UUID_SEGMENT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NUMERIC_SEGMENT = /^\d+$/;
/** ≥8 hex chars reads as an id/hash, not a word ("deadbeef", commit shas). */
const HEX_SEGMENT = /^[0-9a-f]{8,}$/i;

/**
 * Collapse a request path to a bounded-cardinality analytics key: query and
 * fragment stripped, id-ish segments (numeric, uuid, long-hex) replaced with
 * `:id`, and the whole key length-capped. This is also a privacy property: no
 * token, session id, or signed URL ever becomes a persisted jsonb key.
 */
export function normalizePath(path: string): string {
  let p = path;
  const q = p.indexOf("?");
  if (q !== -1) p = p.slice(0, q);
  const h = p.indexOf("#");
  if (h !== -1) p = p.slice(0, h);
  if (p === "" || p === "/") return "/";

  const segments = p.split("/");
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i];
    if (s && (NUMERIC_SEGMENT.test(s) || UUID_SEGMENT.test(s) || HEX_SEGMENT.test(s))) {
      segments[i] = ":id";
    }
  }
  const joined = segments.join("/");
  return joined.length > PATH_KEY_MAX_LENGTH ? joined.slice(0, PATH_KEY_MAX_LENGTH) : joined;
}

/**
 * Reduce a Referer header to its host for the referrers breakdown. Hand-rolled
 * slicing instead of `new URL` because this runs per line and most values are
 * absent ("-") or self-referrals. Returns null for empty, malformed, and
 * same-host referrals (navigation within the site is not a referrer source).
 */
export function normalizeReferrer(referer: string, selfHost: string): string | null {
  if (!referer || referer === "-") return null;
  let rest = referer;
  const scheme = rest.indexOf("://");
  if (scheme !== -1) rest = rest.slice(scheme + 3);
  const slash = rest.indexOf("/");
  if (slash !== -1) rest = rest.slice(0, slash);
  const at = rest.lastIndexOf("@");
  if (at !== -1) rest = rest.slice(at + 1);
  const colon = rest.indexOf(":");
  if (colon !== -1) rest = rest.slice(0, colon);
  let host = rest.toLowerCase();
  if (host.startsWith("www.")) host = host.slice(4);
  if (!host || host.includes(" ")) return null;
  const self = selfHost.startsWith("www.") ? selfHost.slice(4) : selfHost;
  return host === self ? null : host;
}

/** Epoch minutes UTC for a unix-ms timestamp. */
export function epochMinute(ms: number): number {
  return Math.floor(ms / 60_000);
}

/** Zero-padded UTC "YYYYMMDD": lexical order == chronological order. */
export function dayKey(ms: number): string {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  return `${y}${m < 10 ? "0" : ""}${m}${day < 10 ? "0" : ""}${day}`;
}

/**
 * Index of the histogram bucket a latency belongs to. Linear scan: 12
 * comparisons worst case beats log math at this size, and the overflow slot
 * (last index) catches everything past the final bound.
 */
export function latencyBucketIndex(latencyMs: number): number {
  for (let i = 0; i < LATENCY_BUCKET_BOUNDS_MS.length; i++) {
    const bound = LATENCY_BUCKET_BOUNDS_MS[i];
    if (bound !== undefined && latencyMs <= bound) return i;
  }
  return LATENCY_BUCKET_COUNT - 1;
}
