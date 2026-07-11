import { env } from "@otterdeploy/env/server";
import { asnDbPath, geoDbPath } from "@otterdeploy/shared/paths";
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
/** GeoLite2-ASN nests under `autonomous_system_*`; the flat ip-location-db
 *  rebuilds use `as_number` / `as_organization`. Read either. */
interface AsnRecord {
  autonomous_system_number?: number;
  autonomous_system_organization?: string;
  as_number?: number;
  as_organization?: string;
}
interface MmdbReader<T> {
  get(ip: string): T | null;
}
type CountryReader = MmdbReader<CountryRecord>;
type AsnReader = MmdbReader<AsnRecord>;

/** Resolve a DB to a readable path, downloading the free DB when the operator
 *  hasn't supplied one. Returns null when nothing usable could be obtained. */
async function ensureDbPath(input: {
  /** Operator-supplied path — used as-is; never downloaded over. */
  override: string | undefined;
  path: string;
  url: string;
  kind: string;
}): Promise<string | null> {
  if (input.override) return input.override;

  const path = input.path;
  // Already downloaded (and non-empty) — reuse it. A monthly refresh can be
  // layered on later; a stale-but-present DB is far better than none.
  const existing = await stat(path).catch(() => null);
  if (existing && existing.size > 0) return path;

  // Download to a temp sibling then rename, so a partial write never leaves a
  // truncated DB the reader would choke on.
  const res = await fetch(input.url);
  if (!res.ok) throw new Error(`GeoIP ${input.kind} download failed: HTTP ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength === 0) throw new Error(`GeoIP ${input.kind} download was empty`);
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, bytes);
  await rename(tmp, path);
  log.info({ edgeLog: { geo: "downloaded", kind: input.kind, db: path, bytes: bytes.byteLength } });
  return path;
}

// Shared across `--hot` reloads (the ingest sink + this module must agree on
// the same opened reader), same pattern as the ring buffers.
const g = globalThis as typeof globalThis & {
  __edgeGeoReader?: CountryReader | null;
  __edgeAsnReader?: AsnReader | null;
  __edgeGeoInit?: boolean;
};

/** Runtime-resolved `maxmind` open() — keeps the optional dep out of the
 *  static import graph; an absent package throws and the caller disables. */
async function openMmdb<T>(dbPath: string): Promise<MmdbReader<T>> {
  const moduleName: string = "maxmind";
  const mod = (await import(moduleName)) as {
    default?: { open: (p: string) => Promise<MmdbReader<T>> };
    open?: (p: string) => Promise<MmdbReader<T>>;
  };
  const open = mod.default?.open ?? mod.open;
  if (!open) throw new Error("maxmind: no open() export");
  return open(dbPath);
}

/**
 * Open the MaxMind readers if configured. Idempotent + best-effort: any failure
 * (no env path, package not installed, unreadable DB) logs once and leaves that
 * lookup disabled. Called at startup alongside the edge-log sink, and lazily by
 * any enrichment consumer (firewall decisions) — safe either way.
 */
export async function initGeo(): Promise<void> {
  if (g.__edgeGeoInit) return;
  g.__edgeGeoInit = true;
  try {
    const dbPath = await ensureDbPath({
      override: env.EDGE_LOG_GEOIP_DB,
      path: geoDbPath(),
      url: env.EDGE_LOG_GEOIP_URL,
      kind: "country",
    });
    if (dbPath) {
      g.__edgeGeoReader = await openMmdb<CountryRecord>(dbPath);
      log.info({ edgeLog: { geo: "enabled", db: dbPath } });
    }
  } catch (cause) {
    g.__edgeGeoReader = null;
    log.warn({
      edgeLog: { geo: "disabled" },
      error: cause instanceof Error ? cause.message : String(cause),
    });
  }
  try {
    const asnPath = await ensureDbPath({
      override: env.EDGE_LOG_GEOIP_ASN_DB,
      path: asnDbPath(),
      url: env.EDGE_LOG_GEOIP_ASN_URL,
      kind: "asn",
    });
    if (asnPath) {
      g.__edgeAsnReader = await openMmdb<AsnRecord>(asnPath);
      log.info({ edgeLog: { geo: "asn-enabled", db: asnPath } });
    }
  } catch (cause) {
    g.__edgeAsnReader = null;
    log.warn({
      edgeLog: { geo: "asn-disabled" },
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

export function lookupAsn(ip: string): { number: number; org: string | null } | null {
  const reader = g.__edgeAsnReader;
  if (!reader || !ip) return null;
  try {
    const rec = reader.get(ip);
    const number = rec?.autonomous_system_number ?? rec?.as_number;
    if (typeof number !== "number") return null;
    return { number, org: rec?.autonomous_system_organization ?? rec?.as_organization ?? null };
  } catch {
    return null;
  }
}
