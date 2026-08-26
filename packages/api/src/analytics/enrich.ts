/**
 * Per-event enrichment for the collect path (docs/designs/web-analytics.md
 * §4.3): page URL → host/path/UTM, referrer → host, UA → families, plus the
 * exclude-path glob matcher. Everything here is pure and allocation-light;
 * it runs once per event in a batch.
 */

import { Result } from "better-result";

import { normalizeReferrer } from "../edge-logs/analytics-normalize";
import { classifyUa } from "../edge-logs/analytics-ua";
import { normalizeHost } from "../edge-logs/host";

export const MAX_PATH_LENGTH = 512;
export const MAX_UTM_LENGTH = 200;
export const MAX_LANGUAGE_LENGTH = 8;
/** Postgres smallint ceiling. */
const SMALLINT_MAX = 32_767;

export interface UtmParams {
  source: string | null;
  medium: string | null;
  campaign: string | null;
  term: string | null;
  content: string | null;
}

export interface ParsedPageUrl {
  /** Normalized host (lowercase, no port). */
  host: string;
  /** Pathname only: no query, no fragment, ≤ 512 chars, `/` when empty. */
  path: string;
  utm: UtmParams;
}

/** Structural: node's and the DOM lib's URLSearchParams are distinct nominal
 *  types under this tsconfig; `get` is all we use. */
interface SearchParamsLike {
  get(name: string): string | null;
}

function utmParam(params: SearchParamsLike, key: string): string | null {
  const raw = params.get(key);
  if (raw === null) return null;
  const value = raw.trim();
  if (!value) return null;
  return value.length > MAX_UTM_LENGTH ? value.slice(0, MAX_UTM_LENGTH) : value;
}

/**
 * Parse the page URL the tracker sent. Only http(s) URLs with a host are
 * accepted. The query string is discarded except the five `utm_*` keys
 * (design §3: "query strings are stripped server-side too, except UTM").
 */
export function parsePageUrl(u: string): ParsedPageUrl | null {
  const parsed = Result.try({ try: () => new URL(u), catch: () => null });
  if (parsed.isErr()) return null;
  const url = parsed.value;
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  const host = normalizeHost(url.host);
  if (!host) return null;
  let path = url.pathname || "/";
  if (path.length > MAX_PATH_LENGTH) path = path.slice(0, MAX_PATH_LENGTH);
  const params = url.searchParams;
  return {
    host,
    path,
    utm: {
      source: utmParam(params, "utm_source"),
      medium: utmParam(params, "utm_medium"),
      campaign: utmParam(params, "utm_campaign"),
      term: utmParam(params, "utm_term"),
      content: utmParam(params, "utm_content"),
    },
  };
}

/** Referrer host for the sources breakdown; null for absent, malformed and
 *  self-referrals (navigation within the site is "Direct"). */
export function referrerHostOf(referrer: string | undefined, pageHost: string): string | null {
  if (!referrer) return null;
  return normalizeReferrer(referrer, pageHost);
}

export interface UaFamilies {
  browser: string;
  os: string;
  device: string;
  bot: boolean;
}

/** UA reduced to family names (never versions): the same classifier the
 *  traffic plane uses, so both planes agree on what a bot is. */
export function uaFamiliesOf(userAgent: string | null): UaFamilies {
  const ua = classifyUa(userAgent ?? "");
  return {
    browser: ua.browser ?? "Unknown",
    os: ua.os ?? "Unknown",
    device: ua.deviceType,
    bot: ua.bot,
  };
}

/** BCP-47 tag as the browser sent it, lowercased and capped; null when
 *  absent or too short to mean anything. */
export function languageOf(l: string | undefined): string | null {
  if (!l) return null;
  const tag = l.trim().toLowerCase();
  if (tag.length < 2) return null;
  return tag.length > MAX_LANGUAGE_LENGTH ? tag.slice(0, MAX_LANGUAGE_LENGTH) : tag;
}

/** Screen width clamped into smallint range; null when the tracker didn't
 *  send one. */
export function screenWidthOf(sw: number | undefined): number | null {
  if (sw === undefined || !Number.isFinite(sw)) return null;
  return Math.min(SMALLINT_MAX, Math.max(0, Math.trunc(sw)));
}

// ── Exclude-path globs ────────────────────────────────────────────────────

const REGEX_SPECIAL = /[.+?^${}()|[\]\\]/g;

/** One glob → regex source. `**` matches anything (including `/`), `*` one
 *  path segment. A pattern is matched against the whole path. */
function globToSource(pattern: string): string {
  let out = "";
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i] ?? "";
    if (ch === "*") {
      if (pattern[i + 1] === "*") {
        // `/**` at the end also matches the bare prefix (`/admin/**` ⊇ `/admin`).
        const trailing = i + 2 >= pattern.length && out.endsWith("/");
        out = trailing ? `${out.slice(0, -1)}(?:/.*)?` : `${out}.*`;
        i += 2;
      } else {
        out += "[^/]*";
        i += 1;
      }
      continue;
    }
    out += ch.replace(REGEX_SPECIAL, "\\$&");
    i += 1;
  }
  return out;
}

/** Compile a site's exclude patterns into one anchored regex; null when
 *  there are none (the common case, so the hot path is a null check). */
export function compileExcludePaths(patterns: readonly string[]): RegExp | null {
  const sources = patterns
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .map((p) => (p.startsWith("/") ? p : `/${p}`))
    .map(globToSource);
  if (sources.length === 0) return null;
  return new RegExp(`^(?:${sources.join("|")})$`);
}

/** Bounded memo keyed by the joined pattern list: the site cache already
 *  holds a compiled regex per site, this covers ad-hoc callers. */
const MEMO_MAX = 256;
const memo = new Map<string, RegExp | null>();

export function matchesExcludePath(patterns: readonly string[], path: string): boolean {
  if (patterns.length === 0) return false;
  const key = patterns.join("\n");
  let re = memo.get(key);
  if (re === undefined) {
    re = compileExcludePaths(patterns);
    if (memo.size >= MEMO_MAX) {
      const first = memo.keys().next();
      if (!first.done) memo.delete(first.value);
    }
    memo.set(key, re);
  }
  return re !== null && re.test(path);
}
