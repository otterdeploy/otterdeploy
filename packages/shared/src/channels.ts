/**
 * Marketing-channel classification for the web-analytics plane (GA4-style
 * default channel grouping, reduced to what a referrer host + UTM pair can
 * tell us). Design: docs/designs/web-analytics.md §6.
 *
 * Two consumers share ONE rule table: `classifyChannel` (pure JS, for tests
 * and any in-process labelling) and the API layer's SQL `CASE` builder, which
 * reads `CHANNEL_RULES` so a host added here shows up in both without a
 * second list drifting. Keep this file dependency-free.
 */

export const CHANNELS = [
  "Direct",
  "Organic Search",
  "Organic Social",
  "Referral",
  "Email",
  "Paid Search",
  "Paid Social",
  "Display",
  "Affiliate",
  "Video",
  "Other",
] as const;

export type Channel = (typeof CHANNELS)[number];

/** utm_medium (lowercased) → channel. Paid-search mediums flip to Paid Social
 *  when the source is a social network (see `classifyChannel`). */
export const MEDIUM_CHANNELS: Readonly<Record<string, Channel>> = {
  cpc: "Paid Search",
  ppc: "Paid Search",
  paid: "Paid Search",
  paidsearch: "Paid Search",
  retargeting: "Paid Search",
  paidsocial: "Paid Social",
  paid_social: "Paid Social",
  "paid-social": "Paid Social",
  display: "Display",
  banner: "Display",
  cpm: "Display",
  email: "Email",
  "e-mail": "Email",
  newsletter: "Email",
  affiliate: "Affiliate",
  social: "Organic Social",
  "social-network": "Organic Social",
  sm: "Organic Social",
  video: "Video",
};

export const CHANNEL_RULES = {
  /** Exact host or any subdomain (`www.bing.com`). */
  searchHosts: [
    "bing.com",
    "duckduckgo.com",
    "baidu.com",
    "ecosia.org",
    "search.brave.com",
    "startpage.com",
    "qwant.com",
    "kagi.com",
  ],
  /** Registrable label with any country suffix (`google.co.uk`, `yahoo.co.jp`). */
  searchBaseDomains: ["google", "yahoo", "yandex"],
  socialHosts: [
    "facebook.com",
    "fb.com",
    "instagram.com",
    "twitter.com",
    "x.com",
    "t.co",
    "linkedin.com",
    "lnkd.in",
    "reddit.com",
    "tiktok.com",
    "threads.net",
    "mastodon.social",
    "bsky.app",
    "news.ycombinator.com",
  ],
  socialBaseDomains: ["pinterest"],
  videoHosts: ["youtube.com", "youtu.be", "vimeo.com"],
  /** utm_source values that mark a paid medium as Paid Social. */
  socialSources: [
    "facebook",
    "fb",
    "meta",
    "instagram",
    "ig",
    "twitter",
    "x",
    "linkedin",
    "reddit",
    "tiktok",
    "pinterest",
    "threads",
    "bsky",
    "bluesky",
    "mastodon",
    "snapchat",
  ],
  mediumChannels: MEDIUM_CHANNELS,
} as const;

/** POSIX-ERE + JS compatible pattern for a base-domain match: the label
 *  followed by one or two short public-suffix labels. Shared with the SQL
 *  builder (`referrer_host ~ pattern`). */
export function baseDomainPattern(base: string): string {
  return `(^|\\.)${base}\\.[a-z]{2,3}(\\.[a-z]{2,3})?$`;
}

export function matchesHost(host: string, candidate: string): boolean {
  return host === candidate || host.endsWith(`.${candidate}`);
}

export function matchesBaseDomain(host: string, base: string): boolean {
  return new RegExp(baseDomainPattern(base)).test(host);
}

function inHostList(
  host: string,
  hosts: readonly string[],
  baseDomains: readonly string[] = [],
): boolean {
  return (
    hosts.some((h) => matchesHost(host, h)) || baseDomains.some((b) => matchesBaseDomain(host, b))
  );
}

export function isSearchHost(host: string): boolean {
  return inHostList(host, CHANNEL_RULES.searchHosts, CHANNEL_RULES.searchBaseDomains);
}

export function isSocialHost(host: string): boolean {
  return inHostList(host, CHANNEL_RULES.socialHosts, CHANNEL_RULES.socialBaseDomains);
}

export function isVideoHost(host: string): boolean {
  return inHostList(host, CHANNEL_RULES.videoHosts);
}

function clean(value: string | null | undefined): string | null {
  const v = value?.trim().toLowerCase() ?? "";
  return v === "" ? null : v;
}

function isSocialSource(source: string | null, referrerHost: string | null): boolean {
  if (source !== null) {
    if (CHANNEL_RULES.socialSources.some((s) => s === source)) return true;
    if (source.includes(".") && isSocialHost(source)) return true;
  }
  return referrerHost !== null && isSocialHost(referrerHost);
}

export interface ChannelInput {
  /** Normalized referrer host; null = direct / self-referral. */
  referrerHost: string | null | undefined;
  utmSource: string | null | undefined;
  utmMedium: string | null | undefined;
}

/**
 * Rule order (first match wins): utm_medium table → referrer host lists
 * (search, video, social) → any UTM present = Referral → nothing at all =
 * Direct → Referral. "Other" is reserved for the UI's catch-all and never
 * produced here, so the SQL CASE and this function agree on every input.
 */
export function classifyChannel(input: ChannelInput): Channel {
  const host = clean(input.referrerHost);
  const source = clean(input.utmSource);
  const medium = clean(input.utmMedium);

  if (medium !== null) {
    const byMedium = MEDIUM_CHANNELS[medium];
    if (byMedium === "Paid Search" && isSocialSource(source, host)) return "Paid Social";
    if (byMedium !== undefined) return byMedium;
  }
  if (host !== null) {
    if (isSearchHost(host)) return "Organic Search";
    if (isVideoHost(host)) return "Video";
    if (isSocialHost(host)) return "Organic Social";
  }
  if (source !== null || medium !== null) return "Referral";
  if (host === null) return "Direct";
  return "Referral";
}
