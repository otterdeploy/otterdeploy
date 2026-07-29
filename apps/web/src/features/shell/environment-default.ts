/**
 * Which environment a project opens in when the URL doesn't say.
 *
 * This is deliberately a pure function rather than an expression inside the
 * header nav, because the thing that went wrong here is not visible by reading
 * the call site: the default was `find(slug === "production") ?? environments[0]`
 * over a TanStack DB live query with no `orderBy`. A collection is not
 * intrinsically ordered, so `[0]` is whatever the collection happened to yield —
 * which is why adding an environment could appear to make it the main one.
 * `variables.tsx` already sorts its copy of this query and says so in a comment;
 * the header was the one place that didn't.
 *
 * The order below is authority-first, not convention-first:
 *
 *   1. `project.environmentId` — the project's own pointer, set at create. This
 *      is the only authoritative answer and it is what "main" means. Nothing
 *      about adding, renaming or reordering environments changes it.
 *   2. slug `production` — a convention fallback for projects created before
 *      the pointer existed, or whose pointer references a deleted row.
 *   3. Oldest by `createdAt`, ties broken by slug — deterministic, and the
 *      first environment a project ever had is the best guess at its main one.
 *
 * Step 3 is a fallback, never the primary path: if it is answering, either the
 * project has no pointer or the pointer is dangling, and both are worth fixing
 * at the source rather than papering over here.
 */

export interface EnvironmentLike {
  id: string;
  slug: string;
  /** Wire format is an ISO string; the optimistic row inserts a real Date. */
  createdAt: Date | string;
}

const createdMs = (env: EnvironmentLike): number => {
  const ms = new Date(env.createdAt).getTime();
  // A malformed timestamp must not make the sort non-deterministic — park it
  // last and let the slug tiebreak decide.
  return Number.isFinite(ms) ? ms : Number.POSITIVE_INFINITY;
};

/** Stable display order for the switcher: oldest first, slug as tiebreak. */
export function sortEnvironments<T extends EnvironmentLike>(environments: readonly T[]): T[] {
  return [...environments].sort(
    (a, b) => createdMs(a) - createdMs(b) || a.slug.localeCompare(b.slug),
  );
}

/**
 * The project's main environment, or `undefined` when it has none.
 *
 * `mainEnvironmentId` is `project.environmentId`. A pointer that references an
 * environment this project can't see is treated as absent rather than fatal —
 * a deleted main environment should degrade to the convention, not blank the
 * switcher.
 */
export function resolveDefaultEnvironment<T extends EnvironmentLike>(
  environments: readonly T[],
  mainEnvironmentId: string | null | undefined,
): T | undefined {
  if (environments.length === 0) return undefined;

  if (mainEnvironmentId) {
    const main = environments.find((e) => e.id === mainEnvironmentId);
    if (main) return main;
  }

  const production = environments.find((e) => e.slug === "production");
  if (production) return production;

  return sortEnvironments(environments)[0];
}

/**
 * Is this the project's main environment? Drives the badge in the switcher, so
 * the answer to "which one is production" is legible without opening Settings.
 *
 * Deliberately keyed on the id alone: an environment named "Production" whose
 * slug is `prod`, or a project whose main environment is staging on purpose,
 * both have to badge correctly.
 */
export function isMainEnvironment(
  // Only the id is read, so this takes the narrowest shape rather than
  // `EnvironmentLike` — the nav's list rows carry no `createdAt` and should not
  // have to grow one just to render a badge.
  env: { id: string },
  mainEnvironmentId: string | null | undefined,
): boolean {
  return mainEnvironmentId != null && env.id === mainEnvironmentId;
}
