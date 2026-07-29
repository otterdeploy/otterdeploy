/**
 * Environment slugs that would collide with a generated runtime name.
 *
 * Scoped resources are named `<base><suffix>`, and the suffixes come from two
 * independent sources: an environment contributes `-<slug>`, a preview
 * contributes `-pr-<n>` (see ./scoping). Nothing stops those producing the same
 * string — an environment slugged `pr-7` names its container `web-pr-7`, which
 * is byte-identical to what PR #7's preview names its own.
 *
 * The consequence is not a confusing label, it is two different workloads
 * fighting over one container name, one volume and one host: whichever
 * reconciles last wins, and a preview teardown would destroy an environment's
 * resources (or vice versa) because it cannot tell them apart.
 *
 * Guarding at creation is the only place this is cheap. Once an environment
 * exists with a colliding slug, every rename path has to migrate live
 * containers and volumes.
 */

/** `pr-<digits>`, the shape `previewSlug` generates. Anchored and case-folded —
 *  `PR-7` slugifies to `pr-7` and must be caught too. */
const PREVIEW_SUFFIX = /^pr-\d+$/i;

/**
 * Slugs that would be ambiguous or would collide with platform-generated
 * names. `preview` and `previews` are excluded because the UI uses them as
 * headings for the preview satellites; an environment by that name reads as a
 * feature rather than a place.
 */
const RESERVED = new Set(["preview", "previews", "pr"]);

/** Why a slug was rejected, phrased for the operator creating it. */
export function environmentSlugConflict(slug: string): string | null {
  const normalized = slug.trim().toLowerCase();
  if (PREVIEW_SUFFIX.test(normalized)) {
    return `"${slug}" collides with the name generated for pull-request previews. Pick a slug that isn't pr-<number>.`;
  }
  if (RESERVED.has(normalized)) {
    return `"${slug}" is reserved — previews are not environments, and an environment by that name would be ambiguous.`;
  }
  return null;
}

/** Predicate form for zod refinements. */
export function isEnvironmentSlugAllowed(slug: string): boolean {
  return environmentSlugConflict(slug) === null;
}
