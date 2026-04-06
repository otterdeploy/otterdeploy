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

  project: "project",
  resource: "resource",
  environment: "environment",
  proxyRoute: "proxy_route",
} as const;

export type IdPrefix = (typeof ID_PREFIX)[keyof typeof ID_PREFIX];

// Branded type — gives compile-time safety when passing IDs around
declare const __brand: unique symbol;

/** A branded string ID with a known prefix. */
export type Id<P extends string = string> = string & {
  readonly [__brand]: P;
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
export function hasPrefix<P extends string>(id: string, prefix: P): id is Id<P> {
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
