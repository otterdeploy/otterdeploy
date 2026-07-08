import { env } from "@otterdeploy/env/server";
import { geoDbPath } from "@otterdeploy/shared/paths";
import { log } from "evlog";
/**
 * GeoIP country lookup (edge-logs Phase 2).
 *
 * Returns an ISO country code for a client IP, or null when GeoIP is
 * unavailable. Zero-config by default: when `EDGE_LOG_GEOIP_DB` is unset, the
 * sink downloads a free, no-key IP→country database (public-domain DB-IP
 * country-lite, MaxMind DB format) to `<DATA_ROOT>/geoip` and opens that. Set
 * `EDGE_LOG_GEOIP_DB` to point at your own `.mmdb` and the download is skipped.
 *
 * Everything is best-effort: a missing file, a failed download, or an unreadable
 * DB logs once and leaves `lookupCountry` returning null — ingest never breaks.
 *
 * `initGeo()` resolves + opens the reader once at startup (async); the hot-path
 * `lookupCountry()` the ingest loop calls per access log is a sync map lookup.
 */
import { mkdir, rename, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/** Minimal shape of the maxmind reader we use — avoids a hard type dep. Two
 *  record layouts exist in the wild: MaxMind GeoLite2 / DB-IP official nest the
 *  code under `country.iso_code`; the free ip-location-db rebuilds put a flat
 *  `country_code`. We read either so both the managed download and an
 *  operator-supplied GeoLite2 work. */
interface CountryRecord {
  country?: { iso_code?: string };
  country_code?: string;
}
interface CountryReader {
  get(ip: string): CountryRecord | null;
}

/** Resolve the DB to a readable path, downloading the free DB when the operator
 *  hasn't supplied one. Returns null when nothing usable could be obtained. */
async function ensureDbPath(): Promise<string | null> {
  // Operator supplied a path — use it as-is; never download over it.
  if (env.EDGE_LOG_GEOIP_DB) return env.EDGE_LOG_GEOIP_DB;

  const path = geoDbPath();
  // Already downloaded (and non-empty) — reuse it. A monthly refresh can be
  // layered on later; a stale-but-present DB is far better than none.
  const existing = await stat(path).catch(() => null);
  if (existing && existing.size > 0) return path;

  // Download to a temp sibling then rename, so a partial write never leaves a
  // truncated DB the reader would choke on.
  const res = await fetch(env.EDGE_LOG_GEOIP_URL);
  if (!res.ok) throw new Error(`GeoIP download failed: HTTP ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength === 0) throw new Error("GeoIP download was empty");
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, bytes);
  await rename(tmp, path);
  log.info({ edgeLog: { geo: "downloaded", db: path, bytes: bytes.byteLength } });
  return path;
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
  try {
    const dbPath = await ensureDbPath();
    if (!dbPath) return;
    // Runtime-resolved specifier keeps `maxmind` out of the static import graph
    // (it's an optional dep); an absent package just throws here and geo stays off.
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
    const rec = reader.get(ip);
    return rec?.country?.iso_code ?? rec?.country_code ?? null;
  } catch {
    return null;
  }
}
