/**
 * GeoIP country lookup (edge-logs Phase 2).
 *
 * Returns an ISO country code for a client IP, or null when GeoIP isn't
 * configured. Wiring is OPT-IN and dependency-OPTIONAL:
 *   - set `EDGE_LOG_GEOIP_DB` to a MaxMind GeoLite2-Country `.mmdb` path, and
 *   - install the optional `maxmind` package (`bun add maxmind`).
 * The MaxMind DB is license-gated, so the operator supplies it; we never bundle
 * it. With either piece missing, `lookupCountry` cleanly returns null and ingest
 * stays dependency-free.
 *
 * `initGeo()` opens the reader once at startup (async); `lookupCountry()` is the
 * hot-path sync lookup the ingest loop calls per access log.
 */
import { env } from "@otterdeploy/env/server";
import { log } from "evlog";

/** Minimal shape of the maxmind reader we use — avoids a hard type dep. */
interface CountryReader {
  get(ip: string): { country?: { iso_code?: string } } | null;
}

// Shared across `--hot` reloads (the ingest sink + this module must agree on
// the same opened reader), same pattern as the ring buffers.
const g = globalThis as typeof globalThis & {
  __edgeGeoReader?: CountryReader | null;
  __edgeGeoInit?: boolean;
};

/**
 * Open the MaxMind reader if configured. Idempotent + best-effort: any failure
 * (no env path, package not installed, unreadable DB) logs once and leaves geo
 * disabled. Call once at startup, alongside the edge-log sink.
 */
export async function initGeo(): Promise<void> {
  if (g.__edgeGeoInit) return;
  g.__edgeGeoInit = true;
  const dbPath = env.EDGE_LOG_GEOIP_DB;
  if (!dbPath) return;
  try {
    // Runtime-resolved specifier so the optional dep isn't a static/type
    // dependency — absent `maxmind` just throws here and geo stays off.
    const moduleName: string = "maxmind";
    const mod = (await import(moduleName)) as {
      default?: { open: (p: string) => Promise<CountryReader> };
      open?: (p: string) => Promise<CountryReader>;
    };
    const open = mod.default?.open ?? mod.open;
    if (!open) throw new Error("maxmind: no open() export");
    g.__edgeGeoReader = await open(dbPath);
    log.info({ edgeLog: { geo: "enabled", db: dbPath } });
  } catch (cause) {
    g.__edgeGeoReader = null;
    log.warn({
      edgeLog: { geo: "disabled" },
      error: cause instanceof Error ? cause.message : String(cause),
    });
  }
}

export function lookupCountry(ip: string): string | null {
  const reader = g.__edgeGeoReader;
  if (!reader || !ip) return null;
  try {
    return reader.get(ip)?.country?.iso_code ?? null;
  } catch {
    return null;
  }
}
