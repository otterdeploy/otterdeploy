/**
 * GeoIP country lookup seam (edge-logs Phase 2).
 *
 * Returns an ISO country code for a client IP, or null when no GeoIP
 * database is configured. The `country` field is plumbed end-to-end (parse
 * → ring → persistence → API → the flag column in the UI), so enabling real
 * geo is a drop-in here: wire a MaxMind GeoLite2 reader gated on an
 * EDGE_LOG_GEOIP_DB path. Kept as a pure stub so ingest stays dependency-
 * free until an operator provides the (license-gated) database.
 */

export function lookupCountry(_ip: string): string | null {
  return null;
}
