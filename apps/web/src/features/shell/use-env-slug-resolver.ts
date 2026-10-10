/**
 * The environment segment for a link into a project, from wherever the link
 * is built.
 *
 * Environments are a path segment (`/projects/$project/$env/…`), so a link
 * from outside the project (a notification, the activity popover, a volume or
 * backup row) has to name one. Given the resource's environment id this is
 * that environment's slug; without one it is the project's main environment,
 * resolved the same way the switcher does (./environment-default). Both
 * collections are eager, so this is a synchronous lookup in a render.
 */
import { useLiveQuery } from "@tanstack/react-db";

import { envCollection } from "@/features/projects/data/env";
import { projectCollection } from "@/features/projects/data/project";

import { FALLBACK_ENV_SLUG, resolveDefaultEnvironment } from "./environment-default";

export interface EnvSlugTarget {
  /** Either identifies the project. */
  projectSlug?: string;
  projectId?: string;
  /** The resource's environment, when the caller knows it. */
  environmentId?: string | null;
}

export function useEnvSlugResolver(): (target: EnvSlugTarget) => string {
  const { data: projects } = useLiveQuery((q) => q.from({ p: projectCollection }), []);
  const { data: environments } = useLiveQuery((q) => q.from({ e: envCollection }), []);

  return (target) => {
    if (target.environmentId) {
      const exact = environments.find((e) => e.id === target.environmentId);
      if (exact) return exact.slug;
    }
    const project = projects.find((p) =>
      target.projectId ? p.id === target.projectId : p.slug === target.projectSlug,
    );
    if (!project) return FALLBACK_ENV_SLUG;
    const own = environments.filter((e) => e.projectId === project.id);
    return resolveDefaultEnvironment(own, project.environmentId)?.slug ?? FALLBACK_ENV_SLUG;
  };
}
