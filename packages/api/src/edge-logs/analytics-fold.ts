/**
 * The pure half of the analytics accumulator: acc shapes, constructors, and
 * {@link foldLine}, which folds one access-log line into per-(host, minute)
 * and per-(host, UTC day) accumulators. No timers, no DB, no globals — the
 * live singleton in ./aggregate and the historical backfill both call this,
 * which is what guarantees their numbers agree byte-for-byte.
 */

import { LATENCY_BUCKET_COUNT } from "@otterdeploy/db/schema/edge-stat";

import type { UaClass } from "./analytics-ua";
import type { EdgeLogLine } from "./types";

import {
  dayKey,
  epochMinute,
  latencyBucketIndex,
  normalizePath,
  normalizeReferrer,
} from "./analytics-normalize";
import { classifyUa } from "./analytics-ua";

/** The subset of a log line the accumulator reads. A Pick rather than the full
 *  line so the backfill can replay raw DB rows through {@link foldLine}
 *  without fabricating fields analytics never looks at. */
export type AnalyticsLine = Pick<
  EdgeLogLine,
  | "ts"
  | "host"
  | "path"
  | "status"
  | "latencyMs"
  | "clientIp"
  | "country"
  | "userAgent"
  | "referer"
  | "reqBytes"
  | "resBytes"
>;

/** Distinct path keys persisted per (host, day); the tail folds into this. */
export const PATHS_PER_DAY_CAP = 2_000;
const REFERRERS_PER_DAY_CAP = 500;
export const OVERFLOW_KEY = "__other";
/** Global cap on retained visitor hashes across all (host, day) sets. Past
 *  it, new visitors stop being counted and the day is marked approximate:
 *  an honest undercount, never a fabricated number. ~8 bytes a hash. */
export const VISITOR_HASH_CAP = 1_000_000;

export interface MinuteAcc {
  host: string;
  minute: number;
  requests: number;
  botRequests: number;
  s2xx: number;
  s3xx: number;
  s4xx: number;
  s5xx: number;
  sOther: number;
  reqBytes: number;
  resBytes: number;
  latencyBuckets: number[];
  latencySumMs: number;
  latencyMaxMs: number;
}

export interface DayAcc {
  host: string;
  day: string;
  requests: number;
  botRequests: number;
  reqBytes: number;
  resBytes: number;
  s2xx: number;
  s3xx: number;
  s4xx: number;
  s5xx: number;
  sOther: number;
  statuses: Record<string, number>;
  visitors: number;
  approximate: boolean;
  countries: Record<string, number>;
  paths: Record<string, number>;
  referrers: Record<string, number>;
  browsers: Record<string, number>;
  oses: Record<string, number>;
  deviceTypes: Record<string, number>;
  latencyBuckets: number[];
  latencySumMs: number;
}

/** The maps {@link foldLine} writes into: the live singleton state satisfies
 *  this, and the backfill builds throwaway ones per replayed day. */
export interface FoldMaps {
  minutes: Map<string, MinuteAcc>;
  days: Map<string, DayAcc>;
  /** Per-(host, day) salted visitor hashes. NEVER persisted anywhere. */
  visitorSeen: Map<string, Set<bigint>>;
  visitorHashCount: number;
  /** Salt mixed into every visitor hash; the day key alongside it gives
   *  daily rotation. */
  salt: string;
}

export function zeroHistogram(): number[] {
  return Array.from({ length: LATENCY_BUCKET_COUNT }, () => 0);
}

function newMinuteAcc(host: string, minute: number): MinuteAcc {
  return {
    host,
    minute,
    requests: 0,
    botRequests: 0,
    s2xx: 0,
    s3xx: 0,
    s4xx: 0,
    s5xx: 0,
    sOther: 0,
    reqBytes: 0,
    resBytes: 0,
    latencyBuckets: zeroHistogram(),
    latencySumMs: 0,
    latencyMaxMs: 0,
  };
}

function newDayAcc(host: string, day: string): DayAcc {
  return {
    host,
    day,
    requests: 0,
    botRequests: 0,
    reqBytes: 0,
    resBytes: 0,
    s2xx: 0,
    s3xx: 0,
    s4xx: 0,
    s5xx: 0,
    sOther: 0,
    statuses: {},
    visitors: 0,
    approximate: false,
    countries: {},
    paths: {},
    referrers: {},
    browsers: {},
    oses: {},
    deviceTypes: {},
    latencyBuckets: zeroHistogram(),
    latencySumMs: 0,
  };
}

/** Bump `map[key]`, folding into the overflow bucket past `cap` distinct keys.
 *  An existing key keeps counting even once the map is at cap. */
function bumpCapped(map: Record<string, number>, key: string, cap: number): void {
  const existing = map[key];
  if (existing !== undefined) {
    map[key] = existing + 1;
    return;
  }
  if (Object.keys(map).length >= cap) {
    map[OVERFLOW_KEY] = (map[OVERFLOW_KEY] ?? 0) + 1;
    return;
  }
  map[key] = 1;
}

type StatusClass = "s2xx" | "s3xx" | "s4xx" | "s5xx" | "sOther";

function statusClassField(status: number): StatusClass {
  if (status >= 200 && status < 300) return "s2xx";
  if (status >= 300 && status < 400) return "s3xx";
  if (status >= 400 && status < 500) return "s4xx";
  if (status >= 500 && status < 600) return "s5xx";
  return "sOther";
}

function foldMinute(
  m: MinuteAcc,
  line: AnalyticsLine,
  bot: boolean,
  cls: StatusClass,
  bucket: number,
): void {
  m.requests += 1;
  if (bot) m.botRequests += 1;
  m[cls] += 1;
  m.reqBytes += line.reqBytes;
  m.resBytes += line.resBytes;
  m.latencyBuckets[bucket] = (m.latencyBuckets[bucket] ?? 0) + 1;
  m.latencySumMs += line.latencyMs;
  if (line.latencyMs > m.latencyMaxMs) m.latencyMaxMs = line.latencyMs;
}

function foldDay(
  d: DayAcc,
  line: AnalyticsLine,
  ua: UaClass,
  cls: StatusClass,
  bucket: number,
): void {
  d.requests += 1;
  if (ua.bot) d.botRequests += 1;
  d.reqBytes += line.reqBytes;
  d.resBytes += line.resBytes;
  d[cls] += 1;
  // Exact codes: only in-range ones get their own key, the rest share "0" so
  // the record stays bounded no matter what the wire claims.
  const codeKey = line.status >= 100 && line.status < 600 ? String(line.status) : "0";
  d.statuses[codeKey] = (d.statuses[codeKey] ?? 0) + 1;
  d.latencyBuckets[bucket] = (d.latencyBuckets[bucket] ?? 0) + 1;
  d.latencySumMs += line.latencyMs;

  if (line.country && /^[A-Z]{2}$/.test(line.country)) {
    d.countries[line.country] = (d.countries[line.country] ?? 0) + 1;
  }
  bumpCapped(d.paths, normalizePath(line.path), PATHS_PER_DAY_CAP);
  const ref = normalizeReferrer(line.referer, line.host);
  if (ref) bumpCapped(d.referrers, ref, REFERRERS_PER_DAY_CAP);
  if (ua.browser) d.browsers[ua.browser] = (d.browsers[ua.browser] ?? 0) + 1;
  if (ua.os) d.oses[ua.os] = (d.oses[ua.os] ?? 0) + 1;
  d.deviceTypes[ua.deviceType] = (d.deviceTypes[ua.deviceType] ?? 0) + 1;
}

/**
 * Distinct-visitor dedup: bots never count, and the dedup set never leaves
 * the process. 64-bit hash: crc32-sized markers start colliding
 * (undercounting) at exactly the volumes where the number matters. Returns
 * the updated global hash count.
 */
function foldVisitor(
  maps: FoldMaps,
  d: DayAcc,
  dayMapKey: string,
  day: string,
  clientIp: string,
): number {
  let seen = maps.visitorSeen.get(dayMapKey);
  if (!seen) {
    seen = new Set();
    maps.visitorSeen.set(dayMapKey, seen);
  }
  const hash = Bun.hash.xxHash64(`${maps.salt}|${day}|${clientIp}`);
  if (seen.has(hash)) return maps.visitorHashCount;
  if (maps.visitorHashCount >= VISITOR_HASH_CAP) {
    d.approximate = true;
    return maps.visitorHashCount;
  }
  seen.add(hash);
  d.visitors += 1;
  return maps.visitorHashCount + 1;
}

/** Fold one line into the maps. Returns the updated global visitor-hash
 *  count; an unparseable timestamp is dropped rather than misfiled. */
export function foldLine(maps: FoldMaps, line: AnalyticsLine): number {
  const ms = Date.parse(line.ts);
  if (Number.isNaN(ms)) return maps.visitorHashCount;
  const minute = epochMinute(ms);
  const day = dayKey(ms);

  const minuteKey = `${line.host}|${minute}`;
  let m = maps.minutes.get(minuteKey);
  if (!m) {
    m = newMinuteAcc(line.host, minute);
    maps.minutes.set(minuteKey, m);
  }
  const dayMapKey = `${line.host}|${day}`;
  let d = maps.days.get(dayMapKey);
  if (!d) {
    d = newDayAcc(line.host, day);
    maps.days.set(dayMapKey, d);
  }

  const ua = classifyUa(line.userAgent);
  const cls = statusClassField(line.status);
  const bucket = latencyBucketIndex(line.latencyMs);

  foldMinute(m, line, ua.bot, cls, bucket);
  foldDay(d, line, ua, cls, bucket);
  if (!ua.bot && line.clientIp) {
    return foldVisitor(maps, d, dayMapKey, day, line.clientIp);
  }
  return maps.visitorHashCount;
}
