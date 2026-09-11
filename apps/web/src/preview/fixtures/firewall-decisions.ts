/**
 * CrowdSec decisions, shaped like a real install's.
 *
 * The mix is the point. A firewall log is dominated by the community feed
 * arriving in bulk (`CAPI`, hundreds at a time, one scenario, no alert
 * context), with a thin, spiky layer of LOCAL scenarios underneath — the ones
 * that actually say something about this install. A fixture with an even split
 * would make the histogram's origin bands look decorative; the real shape is
 * what shows why they are there.
 *
 * Most decisions have expired. A firewall page that only ever shows live bans
 * is the bug the persisted table exists to fix, so the fixture leans the other
 * way on purpose.
 */

import type { FirewallDecisionRow } from "@/features/firewall/table/decision-cells";

import { seededRandom, weightedPick } from "@/preview/fixtures/random";

interface Source {
  scenario: string;
  origin: string;
  type: string;
  scope: string;
  /** Hours the ban runs for, as CrowdSec spells it. */
  duration: string;
  /** Local scenarios carry alert context; bulk blocklist rows do not. */
  enriched: boolean;
  weight: number;
}

const SOURCES: Source[] = [
  // The community feed: most of the volume, none of the meaning.
  {
    scenario: "crowdsecurity/http-probing",
    origin: "CAPI",
    type: "ban",
    scope: "Ip",
    duration: "168h",
    enriched: false,
    weight: 26,
  },
  {
    scenario: "firehol_cruzit_web_attacks",
    origin: "lists",
    type: "ban",
    scope: "Ip",
    duration: "168h",
    enriched: false,
    weight: 18,
  },
  {
    scenario: "crowdsecurity/http-bad-user-agent",
    origin: "CAPI",
    type: "ban",
    scope: "Ip",
    duration: "168h",
    enriched: false,
    weight: 12,
  },
  // Local scenarios: someone actually reached this install.
  {
    scenario: "crowdsecurity/ssh-bf",
    origin: "crowdsec",
    type: "ban",
    scope: "Ip",
    duration: "4h",
    enriched: true,
    weight: 9,
  },
  {
    scenario: "crowdsecurity/ssh-slow-bf",
    origin: "crowdsec",
    type: "ban",
    scope: "Ip",
    duration: "4h",
    enriched: true,
    weight: 6,
  },
  {
    scenario: "crowdsecurity/http-sensitive-files",
    origin: "crowdsec",
    type: "ban",
    scope: "Ip",
    duration: "4h",
    enriched: true,
    weight: 5,
  },
  {
    scenario: "crowdsecurity/http-crawl-non_statics",
    origin: "crowdsec",
    type: "captcha",
    scope: "Ip",
    duration: "1h",
    enriched: true,
    weight: 4,
  },
  {
    scenario: "crowdsecurity/CVE-2021-41773",
    origin: "crowdsec",
    type: "ban",
    scope: "Ip",
    duration: "24h",
    enriched: true,
    weight: 3,
  },
  {
    scenario: "crowdsecurity/http-generic-bf",
    origin: "crowdsec",
    type: "throttle",
    scope: "Ip",
    duration: "1h",
    enriched: true,
    weight: 2,
  },
  // A human. Rare, and always worth seeing.
  {
    scenario: "manual 'scraping the pricing page'",
    origin: "cscli",
    type: "ban",
    scope: "Range",
    duration: "876000h",
    enriched: false,
    weight: 2,
  },
];

/** Networks a scanner actually comes from, with their ASNs. */
const NETWORKS = [
  { country: "RU", asNumber: "49505", asName: "Selectel" },
  { country: "CN", asNumber: "4134", asName: "Chinanet" },
  { country: "US", asNumber: "14061", asName: "DigitalOcean, LLC" },
  { country: "FR", asNumber: "16276", asName: "OVH SAS" },
  { country: "DE", asNumber: "24940", asName: "Hetzner Online GmbH" },
  { country: "NL", asNumber: "60781", asName: "LeaseWeb Netherlands B.V." },
  { country: "SG", asNumber: "45090", asName: "Shenzhen Tencent" },
  { country: "BR", asNumber: "28573", asName: "Claro NXT" },
  { country: "IN", asNumber: "9829", asName: "National Internet Backbone" },
  { country: "VN", asNumber: "45899", asName: "VNPT Corp" },
];

/** A plausible public address. Deliberately outside the documentation ranges,
 *  because a table of `203.0.113.*` reads as placeholder rather than as data. */
function address(random: () => number, scope: string): string {
  const octet = () => 1 + Math.floor(random() * 254);
  const base = `${45 + Math.floor(random() * 160)}.${octet()}.${octet()}.${octet()}`;
  return scope === "Range" ? `${base.split(".").slice(0, 3).join(".")}.0/24` : base;
}

/**
 * When a decision arrived, as a fraction of the window back from now.
 *
 * Two distributions, because the origins genuinely differ: the community feed
 * arrives in SYNC BURSTS (hundreds at one instant, twelve times a window),
 * while local scenarios trickle in as traffic hits. One distribution for both
 * would flatten exactly the difference the origin bands exist to show.
 */
function arrivalOffset(origin: string, random: () => number): number {
  const bulk = origin === "CAPI" || origin === "lists";
  const raw = bulk ? Math.round(random() * 11) / 11 + (random() - 0.5) * 0.02 : random();
  return Math.min(0.99, Math.max(0.002, raw));
}

/**
 * Alert context, or nothing.
 *
 * A bulk blocklist row has no originating alert, so it has no country, no ASN
 * and no event count. The dashes those produce are the honest answer, not a
 * gap in the fixture — and a preview that filled them in would hide how much
 * of this table is legitimately empty.
 */
function enrichmentFor(source: Source, network: (typeof NETWORKS)[number], random: () => number) {
  if (!source.enriched) {
    return { country: null, asNumber: null, asName: null, eventsCount: null };
  }
  return {
    country: network.country,
    asNumber: network.asNumber,
    asName: network.asName,
    eventsCount: 3 + Math.floor(random() * 60),
  };
}

export function firewallDecisionFixtures(
  count = 640,
  hours = 72,
  seed = 23,
): FirewallDecisionRow[] {
  const random = seededRandom(seed);
  const now = Date.now();
  const spanMs = hours * 3_600_000;
  const rows: FirewallDecisionRow[] = [];

  for (let index = 0; index < count; index++) {
    const source = weightedPick(SOURCES, random);
    const firstSeen = now - arrivalOffset(source.origin, random) * spanMs;

    // Ended once its duration ran out — which most of them have, because the
    // window is three days and the common ban is four hours.
    const durationHours = Number.parseInt(source.duration, 10) || 4;
    const endsAt = firstSeen + durationHours * 3_600_000;
    const ended = endsAt < now;
    const network = NETWORKS[Math.floor(random() * NETWORKS.length)];

    rows.push({
      id: `fwd_${index.toString().padStart(4, "0")}`,
      lapiId: source.origin === "cscli" ? null : 100_000 + index,
      value: address(random, source.scope),
      scope: source.scope,
      type: source.type,
      scenario: source.scenario,
      origin: source.origin,
      duration: source.duration === "876000h" ? "permanent" : source.duration,
      ...enrichmentFor(source, network, random),
      // Materialised on the row, exactly as the feed's SQL expression puts it
      // there — the client evaluator reads a property, the server reads the
      // expression, and both must be looking at the same value.
      state: ended ? "expired" : "active",
      firstSeenAt: new Date(firstSeen).toISOString(),
      lastSeenAt: new Date(ended ? endsAt : now).toISOString(),
      endedAt: ended ? new Date(endsAt).toISOString() : null,
      // CrowdSec's `until`. Sent rather than re-derived from the duration
      // string on the client — see the field's doc comment.
      expiresAt: new Date(endsAt).toISOString(),
    });
  }
  return rows;
}
