/**
 * The whole state of the bucket viewer.
 *
 * Deliberately one object, and deliberately all of it in the URL. The two
 * earlier designs — a "finder" that walks prefixes and a "query" view that
 * filters a flat keyspace — were never two products, because a prefix IS a
 * filter: walking into `invoices/2026-08/` and filtering on
 * `prefix:invoices/2026-08/` are the same S3 call, differing only in whether
 * the delimiter is set.
 *
 * So the breadcrumb, the prefix tree and the filter tokens are three EDITORS OF
 * ONE STATE, and Folders/Flat is a rendering toggle over one result set. That
 * is what lets a selection survive the toggle, and what makes any view a link.
 */
import * as z from "zod";

const groupingSchema = z.enum(["folders", "flat"]);
export type Grouping = z.infer<typeof groupingSchema>;

export const browseSearchSchema = z.object({
  bucket: z.string().optional(),
  /** Key prefix, relative to the destination's configured root. */
  prefix: z.string().default(""),
  grouping: groupingSchema.default("folders"),
  /** Client-side filter tokens, e.g. `size:>1MB class:GLACIER_IR`. */
  q: z.string().default(""),
});
export type BrowseSearch = z.infer<typeof browseSearchSchema>;

/** One breadcrumb hop: the label to show and the prefix it navigates to. */
export interface Crumb {
  label: string;
  prefix: string;
}

/** The breadcrumb IS the prefix, split. */
export function crumbsFor(bucketName: string, prefix: string): Crumb[] {
  const segments = prefix.replace(/\/+$/, "").split("/").filter(Boolean);
  const crumbs: Crumb[] = [{ label: bucketName, prefix: "" }];
  let acc = "";
  for (const segment of segments) {
    acc += `${segment}/`;
    crumbs.push({ label: segment, prefix: acc });
  }
  return crumbs;
}

/** The last path segment of a key, for the name column in folder mode. */
export function basename(key: string): string {
  const trimmed = key.replace(/\/+$/, "");
  return trimmed.slice(trimmed.lastIndexOf("/") + 1);
}

// ── filter tokens ───────────────────────────────────────────────────────────
//
// A small, honest grammar. It filters the PAGE the server returned rather than
// pushing predicates into S3, because ListObjectsV2 has no server-side filter
// beyond the prefix — and claiming otherwise would mean silently returning
// "no matches" for anything past the first 200 keys.

export interface ObjectFilter {
  raw: string;
  matches: (object: { key: string; size: number; storageClass: string }) => boolean;
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

/**
 * Compile one token.
 *
 * An unrecognised token becomes a plain substring match on the key rather than
 * being dropped: someone typing `invoice` means "keys containing invoice", and
 * silently ignoring it would show them the unfiltered list as if it had worked.
 */
function compileToken(token: string): ObjectFilter | null {
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
      return { raw: token, matches: (o) => o.key.toLowerCase().endsWith(`.${wanted}`) };
    }
    if (kind === "size") {
      const predicate = sizePredicate(value);
      if (predicate) return { raw: token, matches: (o) => predicate(o.size) };
    }
  }

  const needle = token.toLowerCase();
  if (needle === "") return null;
  return { raw: token, matches: (o) => o.key.toLowerCase().includes(needle) };
}

export function compileFilters(query: string): ObjectFilter[] {
  return query
    .split(/\s+/)
    .map(compileToken)
    .filter((f): f is ObjectFilter => f !== null);
}

/** Apply every compiled token (AND). */
export function applyFilters<T extends { key: string; size: number; storageClass: string }>(
  objects: readonly T[],
  filters: readonly ObjectFilter[],
): T[] {
  if (filters.length === 0) return [...objects];
  return objects.filter((o) => filters.every((f) => f.matches(o)));
}

/** Add a token to a query string without duplicating it. */
export function withToken(query: string, token: string): string {
  const parts = query.split(/\s+/).filter(Boolean);
  if (parts.includes(token)) return parts.filter((p) => p !== token).join(" ");
  return [...parts, token].join(" ");
}
