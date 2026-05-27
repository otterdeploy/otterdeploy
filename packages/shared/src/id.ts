/**
 * Branded, prefixed ID generation for KaitoSec entities.
 *
 * Every table uses a human-readable prefix so you can identify the entity
 * type from the ID alone (e.g. "risk_clx1abc...", "ctrl_clx2def...").
 *
 * Usage:
 *   import { createId, ID_PREFIX } from "@kaitosec/shared/id";
 *   const id = createId("risk");        // "risk_clx1abc2def3ghi"
 *   const id = createId(ID_PREFIX.risk); // same, but autocompleted
 */

import { createId as cuid } from "@paralleldrive/cuid2";
import * as z from "zod";

// ---------------------------------------------------------------------------
// Prefix registry — add new prefixes here as tables are created
// ---------------------------------------------------------------------------

export const ID_PREFIX = {
  // auth
  user: "user",
  session: "session",
  account: "account",
  verification: "verification",
  // organizations
  organization: "org",
  member: "member",
  invitation: "invite",

  project: "project",
  resource: "resource",
  deployment: "deployment",
  servicePort: "port",
  serviceMount: "mnt",
  serviceEnvVar: "senv",
  projectEnvVar: "penv",
  projectEnvSubscription: "psub",
  environment: "env",
  proxyRoute: "proxy_route",
  server: "server",
  // workspace: "workspace",
  workspace: "wksp",

  // git source connections
  gitProvider: "gitprov",
  gitInstallation: "gitinst",
  gitRepo: "gitrepo",
} as const;

export type IdPrefix = (typeof ID_PREFIX)[keyof typeof ID_PREFIX];

/**
 * Branded string ID with a known prefix.
 *
 * Uses a plain property-name brand (not a `unique symbol`) so it survives
 * declaration emission across composite projects — a unique-symbol brand
 * trips TS4058 ("cannot be named") in consumers that emit .d.ts files.
 * Same level of safety: a plain string can't satisfy `Id<P>` without a cast.
 */
export type Id<P extends string = string> = string & {
  readonly __brand: P;
};

/**
 * Create a prefixed, collision-resistant unique ID using cuid2.
 *
 * Format: `{prefix}_{cuid2}`
 *
 * @example
 *   createId("risk")  // "risk_clx1abc2def3ghi"
 *   createId("ctrl")  // "ctrl_clx9xyz8wvu7tsr"
 */
export function createId<P extends IdPrefix>(prefix: P): Id<P> {
  // this does not check the prefix properly an runtime
  return `${prefix}_${cuid()}` as Id<P>;
}

/**
 * Extract the prefix from a branded ID.
 *
 * @example
 *   idPrefix("risk_clx1abc2def3ghi") // "risk"
 */
export function idPrefix(id: string): string | null {
  const idx = id.indexOf("_");
  if (idx === -1) return null;
  return id.slice(0, idx);
}

/**
 * Check if an ID has a specific prefix.
 *
 * @example
 *   hasPrefix("risk_clx1abc", "risk") // true
 */
export function hasPrefix<P extends string>(
  id: string,
  prefix: P,
): id is Id<P> {
  return id.startsWith(`${prefix}_`);
}

/**
 * Zod schema for a branded, prefixed ID.
 *
 * Validates at runtime that the string starts with the expected prefix
 * and outputs `Id<P>` (which extends `string`, so it works with Drizzle).
 *
 * @example
 *   z.object({ riskId: zId("risk") })
 */
export function zId<P extends IdPrefix>(prefix: P) {
  return z
    .string()
    .regex(new RegExp(`^${prefix}_`), `ID must start with "${prefix}_"`)
    .transform((s) => s as Id<P>);
}

/**
 * Branded string slug. URL-safe identifier scoped to an entity kind
 * (e.g. `Slug<"project">` for project slugs, `Slug<"env">` for env slugs).
 *
 * Same plain-property-brand pattern as `Id<P>` so it survives .d.ts emit.
 */
export type Slug<P extends string = string> = string & {
  readonly __slug: P;
};

/**
 * Zod validator that normalizes any string into a slug (lowercase, trimmed,
 * dashes only) and brands it for the given entity kind. The runtime check is
 * `.slugify().min(2).max(48)` — the brand is compile-time only.
 *
 * @example
 *   z.object({ slug: zSlug("project") })
 */
export function zSlug<P extends string>(brand: P) {
  // The `brand` arg is type-only at runtime — it just narrows the resulting
  // Slug<P> generic so TS distinguishes Slug<"project"> from Slug<"env">.
  void brand;
  return z
    .string()
    .slugify()
    .min(2)
    .max(48)
    .transform((s) => s as Slug<P>);
}

export type EnvSlug = Slug<typeof ID_PREFIX.environment>;
export type ProjectSlug = Slug<typeof ID_PREFIX.project>;
export type WorkspaceId = Id<typeof ID_PREFIX.workspace>;
