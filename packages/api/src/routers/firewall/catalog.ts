/**
 * Curated catalog of well-known, free, no-account public IP blocklists. Operators
 * toggle these on with one click; the platform imports them into CrowdSec on a
 * schedule. All are plain-text IP/CIDR lists fetched over https. See
 * docs/designs/deployment-protection.md §10.
 */
export interface CatalogList {
  slug: string;
  name: string;
  description: string;
  url: string;
  /** Suggested ban duration (hours) + refresh cadence (minutes). */
  durationHours: number;
  intervalMinutes: number;
}

export const BLOCKLIST_CATALOG: readonly CatalogList[] = [
  {
    slug: "firehol-level1",
    name: "FireHOL Level 1",
    description:
      "Conservative aggregate of the most reputable attack/abuse lists. Very low false-positive risk — a safe default.",
    url: "https://iplists.firehol.org/files/firehol_level1.netset",
    durationHours: 24,
    intervalMinutes: 360,
  },
  {
    slug: "spamhaus-drop",
    name: "Spamhaus DROP",
    description:
      "Networks Spamhaus recommends dropping entirely — hijacked ranges and dedicated spam/abuse operations.",
    url: "https://www.spamhaus.org/drop/drop.txt",
    durationHours: 24,
    intervalMinutes: 720,
  },
  {
    slug: "blocklist-de",
    name: "blocklist.de",
    description:
      "IPs reported in the last 48h for attacks on the blocklist.de fail2ban network (ssh, mail, web, …).",
    url: "https://lists.blocklist.de/lists/all.txt",
    durationHours: 12,
    intervalMinutes: 180,
  },
  {
    slug: "tor-exit-nodes",
    name: "Tor exit nodes",
    description:
      "Current Tor exit relays. Block only if you don't want anonymous traffic — legitimate users do use Tor.",
    url: "https://check.torproject.org/torbulkexitlist",
    durationHours: 6,
    intervalMinutes: 120,
  },
];

export function catalogBySlug(slug: string): CatalogList | undefined {
  return BLOCKLIST_CATALOG.find((c) => c.slug === slug);
}
