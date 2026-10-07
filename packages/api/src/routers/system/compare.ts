/**
 * Semver comparison for platform version tags (e.g. "v0.5.0"). This parses
 * `[v]major.minor.patch[-prerelease]` and orders with Bun's built-in semver, a
 * prerelease sorting BEFORE its release (0.5.0-rc.1 < 0.5.0), which is all the
 * updater needs for the "is latest strictly newer than current?" question.
 *
 * Server-side only for the ordering: the CLI bundle (which runs on Node) reaches
 * this module through compat.ts but only ever calls `parseVersion`.
 */

export interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  /** Prerelease identifier ("" ⇒ a final release). */
  prerelease: string;
}

const VERSION_RE = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

/** Parse a version tag, or null if it isn't `[v]X.Y.Z[-pre]`. Non-release
 *  sentinels like "dev"/"latest" parse to null (never comparable ⇒ no update). */
export function parseVersion(input: string | null | undefined): ParsedVersion | null {
  if (!input) return null;
  const m = VERSION_RE.exec(input.trim());
  if (!m) return null;
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    prerelease: m[4] ?? "",
  };
}

/** -1 if a<b, 0 if equal, 1 if a>b. Unparseable inputs sort as "older" than any
 *  real version (so "dev" never counts as newer than a release, and a garbage
 *  latest never triggers an update).
 *
 *  `parseVersion` gates first: `Bun.semver.order` throws on sentinels like
 *  "dev"/"latest" and reads partial versions ("1.2") as ranges, so only full
 *  `[v]X.Y.Z[-pre]` tags reach it. It orders prereleases per semver: numeric
 *  identifiers numerically (nightly.20260820.10 > nightly.20260820.9), and when
 *  one list prefixes the other the longer sorts higher (nightly.20260820.2 >
 *  nightly.20260820, a same-day re-cut outranks the day's first). */
export function compareVersions(
  a: string | null | undefined,
  b: string | null | undefined,
): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb || a == null || b == null) return pa ? 1 : pb ? -1 : 0;
  return Bun.semver.order(a.trim(), b.trim());
}

/** True when `latest` is a real version strictly newer than `current`. */
export function isNewer(
  current: string | null | undefined,
  latest: string | null | undefined,
): boolean {
  if (!parseVersion(latest)) return false;
  return compareVersions(latest, current) > 0;
}
