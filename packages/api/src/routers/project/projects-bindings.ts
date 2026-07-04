/**
 * Field normalization for project updates. The git repo / image binding moved
 * onto the service (edited via the service Source card, staged into the
 * manifest), so the only project-level field that still needs normalizing is
 * the custom domain — the FK-ownership validation that used to live here went
 * with the columns.
 */

/** Normalize a customDomain patch value — undefined passes through (no
 *  change); anything else trims + lowercases, collapsing empty to null. */
export function normalizeCustomDomain(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  return value?.trim().toLowerCase() || null;
}
