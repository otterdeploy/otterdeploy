/**
 * Dashboard URLs built outside the dashboard: the pull-request comment and
 * commit status the server posts, and `otd open` in the CLI.
 *
 * These mirror the web route tree (`apps/web/src/routes`): a project lives at
 * `/$org/projects/$project`, an environment at `/$env` under it, and a
 * resource panel at `/$env/r/$resource`. GitHub keeps the links it is given
 * forever, so they are built in one place.
 */

export interface ProjectUrlInput {
  /** The dashboard origin; a trailing slash is tolerated. */
  base: string;
  orgSlug: string;
  projectSlug: string;
  /** Omitted: the project's default environment. */
  envSlug?: string;
  /** A resource panel in `envSlug`. Ignored without an environment. */
  resourceId?: string;
}

const seg = (value: string): string => encodeURIComponent(value);

/** The project, one of its environments, or a resource panel in one. */
export function projectUrl(input: ProjectUrlInput): string {
  const root = `${input.base.replace(/\/+$/, "")}/${seg(input.orgSlug)}/projects/${seg(input.projectSlug)}`;
  if (!input.envSlug) return root;
  const env = `${root}/${seg(input.envSlug)}`;
  return input.resourceId ? `${env}/r/${seg(input.resourceId)}` : env;
}

/** A pull-request preview's deployment, opened over its base service's panel. */
export function previewDeploymentUrl(input: {
  base: string;
  orgSlug: string;
  projectSlug: string;
  envSlug: string;
  resourceId: string;
  deploymentId: string;
  previewId: string;
}): string {
  const panel = projectUrl(input);
  return `${panel}/deployments/${seg(input.deploymentId)}?previewId=${seg(input.previewId)}`;
}
