/**
 * The environment the operator is currently looking at, as an ID.
 *
 * Every environment-scoped read needs the same answer to "which environment?",
 * and the URL only carries a SLUG (`?env=staging`). Resolving that slug to an
 * id was previously nobody's job, so no query ever sent one — the server fell
 * back to its unscoped branch and every environment rendered the same rows.
 * This is the single place that conversion happens.
 *
 * Every consumer MUST scope on the result. `resourceCollection` is one shared
 * on-demand collection: a component that filters on `projectId` alone loads
 * the main-environment subset into it, and from then on every other component
 * sees BOTH environments' rows merged. Partial adoption is worse than none.
 *
 * Returns `undefined` while the environment list is still loading, and for a
 * slug that matches nothing (a stale bookmark). Both mean "the server should
 * use the project's main environment", which is exactly what omitting
 * `environmentId` from a request does — so callers can pass it straight
 * through without branching.
 */
import { eq, useLiveQuery } from "@tanstack/react-db";
import { useSearch } from "@tanstack/react-router";

import { envCollection } from "@/features/projects/data/env";
import { projectCollection } from "@/features/projects/data/project";

import { resolveDefaultEnvironment } from "./environment-default";

export interface ActiveEnvironment {
  id: string | undefined;
  slug: string | undefined;
}

/**
 * Resolves the project's own main-environment pointer rather than taking it as
 * an argument: the components that need scoping (traffic panel, exposed
 * summary, compose status) hold a `projectId` and nothing else, and making
 * them each thread a `project` row through their props purely to filter a
 * query is how call sites end up quietly skipping the filter.
 */
export function useActiveEnvironment(projectId: string | undefined): ActiveEnvironment {
  const { env: envSlug } = useSearch({ from: "/_app/$orgSlug/_shell/$projectSlug" });

  const { data: environments } = useLiveQuery(
    (q) => q.from({ e: envCollection }).where(({ e }) => eq(e.projectId, projectId ?? "")),
    [projectId],
  );

  const { data: project } = useLiveQuery(
    (q) =>
      q
        .from({ p: projectCollection })
        .where(({ p }) => eq(p.id, projectId ?? ""))
        .findOne(),
    [projectId],
  );

  // An explicit `?env=` wins; otherwise fall back to the same default the
  // switcher displays, so the list and the switcher label can never disagree.
  const selected = envSlug
    ? environments.find((e) => e.slug === envSlug)
    : resolveDefaultEnvironment(environments, project?.environmentId);

  return { id: selected?.id, slug: selected?.slug };
}
