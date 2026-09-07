/**
 * The whole state of the bucket workbench, and the small pure helpers over it.
 *
 * Deliberately one object, and deliberately all of it in the URL. A prefix IS
 * a filter — walking into `invoices/2026-08/` and filtering on
 * `prefix:invoices/2026-08/` are the same ListObjectsV2 call, differing only
 * in whether the delimiter is set — so the breadcrumb and the filter tokens
 * are two EDITORS OF ONE STATE, and Folders/Flat is a rendering toggle over
 * one result set. That is what lets a selection survive
 * the toggle, and what makes any view a link.
 */
import * as z from "zod";

export const groupingSchema = z.enum(["folders", "flat"]);
export type Grouping = z.infer<typeof groupingSchema>;

export const bucketsSearchSchema = z.object({
  bucket: z.string().optional(),
  /** Key prefix, relative to the bucket's configured root. */
  prefix: z.string().default(""),
  grouping: groupingSchema.default("folders"),
  /** Filter tokens, e.g. `size:>1MB class:GLACIER_IR modified:>1y`. */
  q: z.string().default(""),
});
export type BucketsSearch = z.infer<typeof bucketsSearchSchema>;

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

/**
 * Is this selection entry a folder rather than an object?
 *
 * The selection holds prefixes and object keys in ONE map, because "3 of 12
 * selected" would be a lie if folders lived in a second one. They need no
 * discriminator field: a prefix always ends in `/` and an object key never
 * does — `listObjects` drops the zero-byte folder marker whose key equals
 * the prefix, which is the only key that could collide.
 */
export function isPrefixSelection(key: string): boolean {
  return key.endsWith("/");
}

/** The last path segment of a key, for the name column in folder mode. */
export function basename(key: string): string {
  const trimmed = key.replace(/\/+$/, "");
  return trimmed.slice(trimmed.lastIndexOf("/") + 1);
}

const SIZE_UNITS = ["B", "kB", "MB", "GB", "TB"] as const;

/** Human size, decimal like the providers bill. Exact for bytes. */
export function formatSize(bytes: number): string {
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < SIZE_UNITS.length - 1) {
    value /= 1000;
    unit += 1;
  }
  return unit === 0 ? `${value} B` : `${value.toFixed(1)} ${SIZE_UNITS[unit]}`;
}

/**
 * A short provider label for the header tag: `s3 · eu-central-1`, `r2`,
 * or the endpoint's host for anything self-hosted.
 */
export function providerLabel(bucket: { endpoint: string | null; region: string | null }): string {
  if (bucket.endpoint === null || bucket.endpoint === "") {
    return bucket.region === null || bucket.region === "" ? "s3" : `s3 · ${bucket.region}`;
  }
  const host = hostOf(bucket.endpoint);
  if (host === null) return "s3-compatible";
  if (host.endsWith(".r2.cloudflarestorage.com")) return "r2";
  if (host.endsWith(".digitaloceanspaces.com")) return "spaces";
  if (host.endsWith(".backblazeb2.com")) return "b2";
  return host;
}

function hostOf(endpoint: string): string | null {
  const parsed = URL.parse(endpoint.includes("://") ? endpoint : `https://${endpoint}`);
  return parsed?.hostname ?? null;
}

/**
 * USD per GB-month at AWS list prices (us-east-1, 2026). An ESTIMATE of the
 * storage line only — no request, retrieval or transfer costs — shown only
 * for buckets on AWS proper, because other endpoints bill differently and a
 * number computed from the wrong price sheet would be a confident lie.
 */
const STORAGE_CLASS_USD_PER_GB: Record<string, number> = {
  STANDARD: 0.023,
  INTELLIGENT_TIERING: 0.023,
  STANDARD_IA: 0.0125,
  ONEZONE_IA: 0.01,
  GLACIER_IR: 0.004,
  GLACIER: 0.0036,
  DEEP_ARCHIVE: 0.00099,
  REDUCED_REDUNDANCY: 0.024,
};

/**
 * Estimated monthly storage cost, or null when any class in the mix has no
 * list price we know — a partial sum would read as a total.
 */
export function estimatedMonthlyUsd(
  byClass: readonly { storageClass: string; bytes: number }[],
): number | null {
  let usd = 0;
  for (const { storageClass, bytes } of byClass) {
    const price = STORAGE_CLASS_USD_PER_GB[storageClass.toUpperCase()];
    if (price === undefined) return null;
    usd += (bytes / 1_000_000_000) * price;
  }
  return usd;
}

/** Extensions the preview pane can render inline via a presigned URL. */
const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "avif", "svg"]);

export function isImageKey(key: string): boolean {
  const dot = key.lastIndexOf(".");
  if (dot < 0) return false;
  return IMAGE_EXTENSIONS.has(key.slice(dot + 1).toLowerCase());
}
