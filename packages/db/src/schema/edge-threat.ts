import { index, integer, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Durable scanner-probe rollup: one row per (host, client IP), carrying every
 * suspicious request ever seen for that pair.
 *
 * WHY A ROLLUP AND NOT A QUERY OVER `edge_log`: raw access logs are
 * RANGE-partitioned and swept on a retention window (7 days by default), so an
 * aggregate over them can only ever answer "the last N days". This table is
 * written straight from ingest and never swept, so the Firewall's flagged-IP
 * panel can answer "everything this IP has ever probed" long after the request
 * lines themselves are gone. It's counters, not history: the raw rows remain
 * the only place to see individual requests.
 *
 * Keyed by (host, ip) rather than (org, ip) on purpose: ingest doesn't know
 * which org a domain belongs to, and domains move between orgs. The reader
 * resolves the org's hosts and aggregates across them, exactly like the
 * raw-log path does.
 */
export const edgeThreatIp = pgTable(
  "edge_threat_ip",
  {
    /** Lowercased request host. */
    host: text("host").notNull(),
    clientIp: text("client_ip").notNull(),
    /** ISO-3166-1 alpha-2, when a GeoIP database is configured. Last non-null
     *  lookup wins: an IP's geo doesn't change often, and null means "unknown",
     *  never "no longer known". */
    country: text("country"),
    /** Total suspicious requests, all time. */
    probes: integer("probes").notNull(),
    firstSeen: timestamp("first_seen", { withTimezone: true }).notNull(),
    lastSeen: timestamp("last_seen", { withTimezone: true }).notNull(),
    /** Up to 5 distinct probe paths, for context in the review table. */
    samplePaths: text("sample_paths").array().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.host, t.clientIp] }),
    // The panel reads by the org's hosts, ranked by volume.
    index("edge_threat_ip_host_probes_idx").on(t.host, t.probes),
    index("edge_threat_ip_last_seen_idx").on(t.lastSeen),
  ],
);
