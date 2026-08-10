/**
 * Creating an environment that mirrors the project.
 *
 * "Staging mirrors production" is not a copy taken once. It is a standing
 * relationship. A change to the base manifest reaches every environment that
 * has not overridden that key, and an environment differs only where the
 * operator deliberately made it differ.
 *
 * That is exactly what the manifest's `environments.<slug>` overlay already
 * means. `resolveEnvironment` (stack/manifest/merge.ts) deep-merges the overlay
 * onto the base, and its documented rules are the mirror semantics verbatim:
 *
 *   key absent      → inherits base unchanged   ← this IS mirroring
 *   scalar present  → replaces
 *   object present  → deep-merged
 *   array present   → replaces wholesale
 *   value null      → deletes the key
 *
 * So creating a mirrored environment writes an EMPTY overlay block. Empty means
 * "override nothing", which resolves to a manifest identical to base, no
 * copying, no special case, and no drift by construction. Both `manifest.diff`
 * and `manifest.apply` already resolve per environment, so the environment
 * becomes deployable the moment the block exists.
 *
 * The alternative (deep-copying the base into the overlay at create time)
 * would look identical on day one and then silently stop tracking production on
 * day two, which is the behaviour this is specifically meant to avoid.
 */
import type { Manifest } from "../../stack/manifest";

/**
 * The manifest with an overlay block for `slug`, or the SAME object when one
 * already exists.
 *
 * Returning the original unchanged matters: the caller uses identity to decide
 * whether a manifest write (and therefore a version bump, and therefore a
 * pending change on every other client) is needed at all. Re-creating an
 * existing environment must not churn the manifest.
 */
export function withEnvironmentOverlay(manifest: Manifest, slug: string): Manifest {
  if (manifest.environments?.[slug]) return manifest;
  return {
    ...manifest,
    environments: {
      ...manifest.environments,
      // Empty on purpose: see the module note. This is the mirror.
      [slug]: {},
    },
  };
}

/**
 * Drop an environment's overlay when the environment is deleted.
 *
 * Left behind, the block is inert (nothing resolves against a slug with no
 * environment row) but it is also a trap: re-creating an environment with the
 * same slug would silently inherit the old overrides, and the operator would
 * have no way to see why their "new" environment was not a clean mirror.
 */
export function withoutEnvironmentOverlay(manifest: Manifest, slug: string): Manifest {
  if (!manifest.environments?.[slug]) return manifest;
  const { [slug]: _removed, ...rest } = manifest.environments;
  return {
    ...manifest,
    environments: Object.keys(rest).length > 0 ? rest : undefined,
  };
}
