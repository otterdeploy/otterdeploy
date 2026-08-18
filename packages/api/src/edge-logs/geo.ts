import { env } from "@otterdeploy/env/server";
import { asnDbPath, geoDbPath } from "@otterdeploy/shared/paths";
import { Result } from "better-result";
import { log } from "evlog";
import { open as openMaxmind } from "maxmind";
/**
 * GeoIP country lookup (edge-logs Phase 2).
 *
 * Returns an ISO country code for a client IP, or null when GeoIP is
 * unavailable. Zero-config by default: when `EDGE_LOG_GEOIP_DB` is unset, the
 * sink downloads a free, no-key IP→country database (public-domain DB-IP
 * country-lite, MaxMind DB format) to `<DATA_ROOT>/platform/geoip` and opens
 * that. Set
 * `EDGE_LOG_GEOIP_DB` to point at your own `.mmdb` and the download is skipped.
 *
 * Everything is best-effort: a missing file, a failed download, or an unreadable
 * DB logs once and leaves `lookupCountry` returning null. Ingest never breaks.
 *
 * `initGeo()` resolves + opens the reader once at startup (async); the hot-path
 * `lookupCountry()` the ingest loop calls per access log is a sync map lookup.
 *
 * Record shapes are narrowed with real runtime guards at the read boundary -
 * never asserted: the DB's layout is whatever file the operator pointed us
 * at. Two layouts exist in the wild: MaxMind GeoLite2 / DB-IP official nest
 * the code under `country.iso_code`; the free ip-location-db rebuilds put a
 * flat `country_code` (and `as_number`/`as_organization` for ASN). Both read.
 */
import { mkdir, rename, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { edgeLogGeoipUrls } from "../lib/platform-runtime-settings";

/** The one method we use, yielding an UNKNOWN record: the DB's layout is
 *  whatever file the operator pointed us at, so shapes are narrowed per read. */
interface MmdbReader {
  get(ip: string): unknown;
}

/** Resolve a DB to a readable path, downloading the free DB when the operator
 *  hasn't supplied one. `ok(null)` when nothing usable could be obtained
 *  without an error (no override, no URL response body needed). */
async function ensureDbPath(input: {
  /** Operator-supplied path, used as-is; never downloaded over. */
  override: string | undefined;
  path: string;
  url: string;
  kind: string;
}): Promise<Result<string | null, Error>> {
  if (input.override) return Result.ok(input.override);

  const path = input.path;
  // Already downloaded (and non-empty): reuse it. A monthly refresh can be
  // layered on later; a stale-but-present DB is far better than none.
  const existing = await stat(path).catch(() => null);
  if (existing && existing.size > 0) return Result.ok(path);

  // Download to a temp sibling then rename, so a partial write never leaves a
  // truncated DB the reader would choke on.
  return Result.tryPromise({
    try: async () => {
      const res = await fetch(input.url);
      if (!res.ok) throw new Error(`GeoIP ${input.kind} download failed: HTTP ${res.status}`);
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.byteLength === 0) throw new Error(`GeoIP ${input.kind} download was empty`);
      await mkdir(dirname(path), { recursive: true });
      const tmp = `${path}.${process.pid}.tmp`;
      await writeFile(tmp, bytes);
      await rename(tmp, path);
      log.info({
        edgeLog: { geo: "downloaded", kind: input.kind, db: path, bytes: bytes.byteLength },
      });
      return path;
    },
    catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
  });
}

// Shared across `--hot` reloads (the ingest sink + this module must agree on
// the same opened reader), same pattern as the ring buffers.
declare global {
  var __edgeGeoReader: MmdbReader | null | undefined;
  var __edgeAsnReader: MmdbReader | null | undefined;
  var __edgeGeoInit: boolean | undefined;
}
const g = globalThis;

/**
 * Open one .mmdb. Static import: `maxmind` is a declared dependency and the
 * previous load-by-variable dynamic import was a trap: the bundler couldn't
 * wire it to the chunk it had ALREADY inlined, so the bundled server's
 * runtime resolution failed (`Cannot find package 'maxmind'`: bun's isolated
 * install links it only under packages/api/node_modules) and geo silently
 * died in production while working in dev.
 */
async function openMmdb(dbPath: string): Promise<Result<MmdbReader, Error>> {
  return Result.tryPromise({
    try: async (): Promise<MmdbReader> => openMaxmind(dbPath),
    catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
  });
}

/** Resolve + open one database, logging the outcome; null when disabled. */
async function initReader(input: {
  override: string | undefined;
  path: string;
  url: string;
  kind: string;
  enabledMsg: string;
  disabledMsg: string;
}): Promise<MmdbReader | null> {
  const opened = await (
    await ensureDbPath(input)
  ).andThenAsync(async (dbPath) =>
    dbPath === null
      ? Result.ok<MmdbReader | null, Error>(null)
      : (await openMmdb(dbPath)).map((reader): MmdbReader | null => {
          log.info({ edgeLog: { geo: input.enabledMsg, db: dbPath } });
          return reader;
        }),
  );
  return opened.match({
    ok: (reader) => reader,
    err: (error) => {
      log.warn({ edgeLog: { geo: input.disabledMsg }, error: error.message });
      return null;
    },
  });
}

/**
 * Open the MaxMind readers if configured. Idempotent + best-effort: any failure
 * (no env path, package not installed, unreadable DB) logs once and leaves that
 * lookup disabled. Called at startup alongside the edge-log sink, and lazily by
 * any enrichment consumer (firewall decisions): safe either way.
 */
export async function initGeo(): Promise<void> {
  if (g.__edgeGeoInit) return;
  g.__edgeGeoInit = true;
  // Source URLs are settings-backed (env seeds them) so an air-gapped or
  // mirrored install can be repointed from the UI. The *_DB path overrides
  // stay env-only: they name a file that has to already exist on this host,
  // which isn't something the dashboard can meaningfully validate.
  const geoipUrls = await edgeLogGeoipUrls();
  g.__edgeGeoReader = await initReader({
    override: env.EDGE_LOG_GEOIP_DB,
    path: geoDbPath(),
    url: geoipUrls.country,
    kind: "country",
    enabledMsg: "enabled",
    disabledMsg: "disabled",
  });
  g.__edgeAsnReader = await initReader({
    override: env.EDGE_LOG_GEOIP_ASN_DB,
    path: asnDbPath(),
    url: geoipUrls.asn,
    kind: "asn",
    enabledMsg: "asn-enabled",
    disabledMsg: "asn-disabled",
  });
}

/** Whether country lookups are configured and working. The Analytics surface
 *  reads this so an empty countries list can say "geo isn't set up" instead of
 *  rendering as "no visitors": the two used to be indistinguishable. */
export function geoAvailable(): boolean {
  return g.__edgeGeoReader != null;
}

/** Hand-rolled narrowing (not a schema parse): these run once per ingested
 *  request line, so they must not allocate. */
function countryCodeOf(rec: unknown): string | null {
  if (rec === null || typeof rec !== "object") return null;
  if ("country" in rec) {
    const country = rec.country;
    if (
      country !== null &&
      typeof country === "object" &&
      "iso_code" in country &&
      typeof country.iso_code === "string"
    ) {
      return country.iso_code;
    }
  }
  if ("country_code" in rec && typeof rec.country_code === "string") return rec.country_code;
  return null;
}

function asnOf(rec: unknown): { number: number; org: string | null } | null {
  if (rec === null || typeof rec !== "object") return null;
  const number =
    "autonomous_system_number" in rec && typeof rec.autonomous_system_number === "number"
      ? rec.autonomous_system_number
      : "as_number" in rec && typeof rec.as_number === "number"
        ? rec.as_number
        : null;
  if (number === null) return null;
  const org =
    "autonomous_system_organization" in rec &&
    typeof rec.autonomous_system_organization === "string"
      ? rec.autonomous_system_organization
      : "as_organization" in rec && typeof rec.as_organization === "string"
        ? rec.as_organization
        : null;
  return { number, org };
}

export function lookupCountry(ip: string): string | null {
  const reader = g.__edgeGeoReader;
  if (!reader || !ip) return null;
  return Result.try({
    try: () => countryCodeOf(reader.get(ip)),
    catch: () => null,
  }).unwrapOr(null);
}

export function lookupAsn(ip: string): { number: number; org: string | null } | null {
  const reader = g.__edgeAsnReader;
  if (!reader || !ip) return null;
  return Result.try({
    try: () => asnOf(reader.get(ip)),
    catch: () => null,
  }).unwrapOr(null);
}
