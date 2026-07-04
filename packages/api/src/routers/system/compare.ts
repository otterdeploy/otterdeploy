/**
 * Tiny semver comparison for platform version tags (e.g. "v0.5.0"). We ship a
 * handful of `vX.Y.Z` release tags, so a full `semver` dependency is overkill —
 * this parses `[v]major.minor.patch[-prerelease]` and orders numerically, with
 * a prerelease sorting BEFORE its release (0.5.0-rc.1 < 0.5.0), which is all the
 * updater needs for the "is latest strictly newer than current?" question.
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

const cmpNum = (x: number, y: number): number => (x < y ? -1 : x > y ? 1 : 0);

/** A final release outranks any prerelease of the same core; otherwise order the
 *  prerelease identifiers lexically. */
function comparePrerelease(a: string, b: string): number {
  if (a === b) return 0;
  if (a === "") return 1;
  if (b === "") return -1;
  return a < b ? -1 : 1;
}

/** -1 if a<b, 0 if equal, 1 if a>b. Unparseable inputs sort as "older" than any
 *  real version (so "dev" never counts as newer than a release, and a garbage
 *  latest never triggers an update). */
export function compareVersions(
  a: string | null | undefined,
  b: string | null | undefined,
): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return pa ? 1 : pb ? -1 : 0;
  const core =
    cmpNum(pa.major, pb.major) || cmpNum(pa.minor, pb.minor) || cmpNum(pa.patch, pb.patch);
  return core !== 0 ? core : comparePrerelease(pa.prerelease, pb.prerelease);
}

/** True when `latest` is a real version strictly newer than `current`. */
export function isNewer(
  current: string | null | undefined,
  latest: string | null | undefined,
): boolean {
  if (!parseVersion(latest)) return false;
  return compareVersions(latest, current) > 0;
}
