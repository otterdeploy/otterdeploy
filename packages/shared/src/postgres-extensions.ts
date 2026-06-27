/**
 * Catalog of Postgres extensions the platform can enable on a database
 * resource. Single source of truth shared by:
 *   - the create wizard (advanced-db step toggles)
 *   - the resource settings panel (Extensions card)
 *   - the API handler that persists the selection, picks the right image,
 *     and runs `CREATE EXTENSION` against the live database.
 *
 * `name` is the canonical identifier — it is exactly the string passed to
 * `CREATE EXTENSION "<name>"`, and it is what we persist on the resource.
 *
 * Two kinds of extensions:
 *   - `contrib: true`  — ships inside the stock `postgres:*` image
 *     (postgres-contrib). Enabling one is a pure `CREATE EXTENSION`; no
 *     image change, applies live with ~0 downtime.
 *   - `contrib: false` — the extension's shared objects are NOT in the
 *     stock image. Enabling requires switching the service to an image that
 *     bundles it (`image`), rolling the task, THEN `CREATE EXTENSION`. Two
 *     non-contrib extensions that need *different* images cannot be enabled
 *     together (one image, one base) — that's a conflict the caller reports.
 *
 * Non-contrib images are all PG17-based and ship the standard contrib set,
 * so contrib extensions ride along on them too.
 */

export interface PostgresExtensionMeta {
  /** `CREATE EXTENSION "<name>"` identifier — also what we persist. */
  name: string;
  /** Display name in the wizard / settings UI. */
  label: string;
  /** One-line description shown under the toggle. */
  description: string;
  /** True when the extension ships in the stock postgres image. */
  contrib: boolean;
  /** For non-contrib extensions: the `<repo>:<tag>` image that bundles
   *  the extension. Undefined for contrib extensions (default image). */
  image?: string;
}

export const POSTGRES_EXTENSIONS = [
  {
    name: "pgcrypto",
    label: "pgcrypto",
    description: "cryptographic functions",
    contrib: true,
  },
  {
    name: "uuid-ossp",
    label: "uuid-ossp",
    description: "UUID generation",
    contrib: true,
  },
  {
    name: "pg_stat_statements",
    label: "pg_stat_statements",
    description: "query statistics",
    contrib: true,
  },
  {
    name: "hstore",
    label: "hstore",
    description: "key/value store type",
    contrib: true,
  },
  {
    name: "citext",
    label: "citext",
    description: "case-insensitive text",
    contrib: true,
  },
  {
    name: "vector",
    label: "pgvector",
    description: "vector similarity search",
    contrib: false,
    image: "pgvector/pgvector:pg17",
  },
  {
    name: "postgis",
    label: "PostGIS",
    description: "geographic queries",
    contrib: false,
    image: "postgis/postgis:17-3.4",
  },
  {
    name: "timescaledb",
    label: "TimescaleDB",
    description: "time-series",
    contrib: false,
    image: "timescale/timescaledb:latest-pg17",
  },
] as const satisfies ReadonlyArray<PostgresExtensionMeta>;

export type PostgresExtensionName = (typeof POSTGRES_EXTENSIONS)[number]["name"];

const BY_NAME = new Map<string, PostgresExtensionMeta>(
  POSTGRES_EXTENSIONS.map((ext) => [ext.name, ext]),
);

export function getPostgresExtension(name: string): PostgresExtensionMeta | undefined {
  return BY_NAME.get(name);
}

/** Keep only names we recognise — drops anything stale/unknown so a bad
 *  persisted value can't reach `CREATE EXTENSION`. */
export function knownPostgresExtensions(names: readonly string[]): string[] {
  return names.filter((n) => BY_NAME.has(n));
}

export type ResolveImageResult =
  | { ok: true; image: string; changed: boolean }
  | { ok: false; conflict: string[] };

/**
 * Decide which image a postgres service must run given its enabled
 * extensions. Returns the `defaultImage` when every enabled extension is
 * contrib (or none are enabled). When exactly one non-contrib image is
 * needed, returns it. When two enabled extensions demand *different*
 * images, returns a conflict listing the offending extension names — the
 * caller surfaces this instead of silently dropping one.
 *
 * `changed` tells the caller whether the resolved image differs from the
 * default, i.e. whether a non-contrib extension forced an image swap.
 */
export function resolvePostgresImage(
  enabled: readonly string[],
  defaultImage: string,
): ResolveImageResult {
  const imageToExt = new Map<string, string[]>();
  for (const name of enabled) {
    const meta = BY_NAME.get(name);
    if (!meta?.image) continue;
    const list = imageToExt.get(meta.image) ?? [];
    list.push(name);
    imageToExt.set(meta.image, list);
  }

  const distinctImages = [...imageToExt.keys()];
  if (distinctImages.length > 1) {
    // More than one distinct non-contrib image required — incompatible.
    return { ok: false, conflict: [...imageToExt.values()].flat() };
  }
  // `[0]` is `string | undefined` under noUncheckedIndexedAccess. Undefined ⇒
  // no non-contrib extension enabled ⇒ stay on the default image.
  const image = distinctImages[0];
  if (image === undefined) {
    return { ok: true, image: defaultImage, changed: false };
  }
  return { ok: true, image, changed: image !== defaultImage };
}
