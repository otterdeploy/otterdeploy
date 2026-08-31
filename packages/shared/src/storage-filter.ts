/**
 * The bucket viewer's filter-token grammar, shared by both sides of the wire.
 *
 * The client compiles tokens to narrow the page it is showing; the server
 * compiles the SAME tokens to scope the stats scan. One grammar means the
 * numbers in the stats strip and the rows in the table can never disagree
 * about what "class:GLACIER_IR size:>100MB" selects.
 *
 * S3's ListObjectsV2 has no server-side predicate beyond the prefix, so every
 * token is evaluated over listed entries — which is why the grammar only uses
 * fields a listing already carries (key, size, storage class, last-modified)
 * and never promises a filter it would have to fake.
 */

export interface FilterableObject {
  key: string;
  size: number;
  storageClass: string;
  /** Epoch milliseconds, or null when the listing did not carry one. */
  modifiedMs: number | null;
}

export interface StorageFilter {
  raw: string;
  matches: (object: FilterableObject) => boolean;
}

const SIZE_UNITS: Record<string, number> = {
  b: 1,
  kb: 1_000,
  mb: 1_000_000,
  gb: 1_000_000_000,
  tb: 1_000_000_000_000,
};

/** `1.5MB` → bytes, or null when it isn't a size. */
export function parseSize(text: string): number | null {
  const m = /^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb|tb)?$/i.exec(text.trim());
  if (!m?.[1]) return null;
  const unit = (m[2] ?? "b").toLowerCase();
  const scale = SIZE_UNITS[unit];
  if (scale === undefined) return null;
  return Number(m[1]) * scale;
}

function sizePredicate(expr: string): ((size: number) => boolean) | null {
  const m = /^([<>]=?)?\s*(.+)$/.exec(expr.trim());
  if (!m?.[2]) return null;
  const bytes = parseSize(m[2]);
  if (bytes === null) return null;
  switch (m[1]) {
    case ">":
      return (size) => size > bytes;
    case ">=":
      return (size) => size >= bytes;
    case "<":
      return (size) => size < bytes;
    case "<=":
      return (size) => size <= bytes;
    default:
      return (size) => size === bytes;
  }
}

const AGE_UNITS: Record<string, number> = {
  h: 3_600_000,
  d: 86_400_000,
  w: 7 * 86_400_000,
  // Calendar-free approximations. An age filter is a coarse net ("untouched
  // for a year"), not an accounting boundary, so 30d/365d months and years
  // are the honest amount of precision.
  m: 30 * 86_400_000,
  y: 365 * 86_400_000,
};

/** `30d` / `1y` → milliseconds, or null when it isn't an age. */
export function parseAge(text: string): number | null {
  const m = /^(\d+(?:\.\d+)?)\s*(h|d|w|m|y)$/i.exec(text.trim());
  if (!m?.[1] || !m[2]) return null;
  const scale = AGE_UNITS[m[2].toLowerCase()];
  if (scale === undefined) return null;
  return Number(m[1]) * scale;
}

/**
 * `modified:<30d` — touched within the last 30 days.
 * `modified:>1y`  — untouched for over a year.
 *
 * The comparison is on AGE, because that is how the question is asked; an
 * object with no last-modified matches neither, since claiming it is either
 * fresh or stale would be a guess.
 */
function modifiedPredicate(
  expr: string,
  nowMs: number,
): ((modifiedMs: number | null) => boolean) | null {
  const m = /^([<>])\s*(.+)$/.exec(expr.trim());
  if (!m?.[1] || !m[2]) return null;
  const age = parseAge(m[2]);
  if (age === null) return null;
  const cutoff = nowMs - age;
  return m[1] === "<"
    ? (modifiedMs) => modifiedMs !== null && modifiedMs >= cutoff
    : (modifiedMs) => modifiedMs !== null && modifiedMs < cutoff;
}

/** The extension a `type:` token matches against: `pdf` for `a/b/c.PDF`. */
export function keyExtension(key: string): string | null {
  const name = key.slice(key.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) return null;
  const ext = name.slice(dot + 1).toLowerCase();
  return ext.length > 10 ? null : ext;
}

/**
 * Compile one token.
 *
 * An unrecognised token becomes a plain substring match on the key rather than
 * being dropped: someone typing `invoice` means "keys containing invoice", and
 * silently ignoring it would show the unfiltered list as if it had worked.
 */
function compileToken(token: string, nowMs: number): StorageFilter | null {
  const [rawKind, ...rest] = token.split(":");
  const kind = (rawKind ?? "").toLowerCase();
  const value = rest.join(":");

  if (value !== "") {
    if (kind === "prefix") {
      return { raw: token, matches: (o) => o.key.startsWith(value) };
    }
    if (kind === "class") {
      const wanted = value.toUpperCase();
      return { raw: token, matches: (o) => o.storageClass.toUpperCase() === wanted };
    }
    if (kind === "type") {
      const wanted = value.toLowerCase();
      return { raw: token, matches: (o) => keyExtension(o.key) === wanted };
    }
    if (kind === "size") {
      const predicate = sizePredicate(value);
      if (predicate) return { raw: token, matches: (o) => predicate(o.size) };
    }
    if (kind === "modified") {
      const predicate = modifiedPredicate(value, nowMs);
      if (predicate) return { raw: token, matches: (o) => predicate(o.modifiedMs) };
    }
  }

  const needle = token.toLowerCase();
  if (needle === "") return null;
  return { raw: token, matches: (o) => o.key.toLowerCase().includes(needle) };
}

/** Compile a whole query. `nowMs` anchors the `modified:` tokens. */
export function compileStorageFilters(query: string, nowMs: number): StorageFilter[] {
  return query
    .split(/\s+/)
    .map((token) => compileToken(token, nowMs))
    .filter((f): f is StorageFilter => f !== null);
}

/** Apply every compiled token (AND). */
export function applyStorageFilters<T extends FilterableObject>(
  objects: readonly T[],
  filters: readonly StorageFilter[],
): T[] {
  if (filters.length === 0) return [...objects];
  return objects.filter((o) => filters.every((f) => f.matches(o)));
}

/** Toggle a token in a query string: present → removed, absent → appended. */
export function withStorageToken(query: string, token: string): string {
  const parts = query.split(/\s+/).filter(Boolean);
  if (parts.includes(token)) return parts.filter((p) => p !== token).join(" ");
  return [...parts, token].join(" ");
}

/** Whether the query already carries a token, for chip active states. */
export function hasStorageToken(query: string, token: string): boolean {
  return query.split(/\s+/).includes(token);
}
