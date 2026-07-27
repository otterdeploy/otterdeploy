/**
 * Which destinations a given viewer may see.
 *
 * Split from ./nav-manifest so that module stays a pure description of the
 * app's navigation — this is the one place that decides what to withhold, and
 * the three nav surfaces all route through it rather than each re-deriving the
 * rule.
 */

import type { NavManifestItem } from "./nav-manifest";

/** Drop the destinations this viewer must not see, then drop any group left
 *  empty — a heading with nothing under it is worse than no heading. */
export function visibleNav<G extends { items: readonly NavManifestItem[] }>(
  groups: readonly G[],
  isInstallAdmin: boolean,
): G[] {
  return groups
    .map((g) => ({ ...g, items: g.items.filter((i) => !i.installAdminOnly || isInstallAdmin) }))
    .filter((g) => g.items.length > 0);
}
