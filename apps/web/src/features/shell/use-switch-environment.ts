/**
 * Switch the environment on screen.
 *
 * The environment is a path segment, so switching it is a path rewrite: on a
 * per-environment page (`/projects/$p/staging/logs`) swap the segment and stay
 * on the page; anywhere else in the project (its settings, the variables
 * matrix, the project index) open that environment's canvas. The current
 * route is opaque to the header and the palette, so this goes through the
 * concrete path rather than a typed `to`.
 */
import { useNavigate, useParams } from "@tanstack/react-router";

export function switchedEnvironmentPath(input: {
  pathname: string;
  orgSlug: string;
  projectSlug: string;
  /** The environment in the current path, if the page has one. */
  currentEnvSlug: string | undefined;
  nextEnvSlug: string;
}): string {
  const base = `/${input.orgSlug}/projects/${input.projectSlug}`;
  const current = input.currentEnvSlug ? `${base}/${input.currentEnvSlug}` : null;
  if (current && (input.pathname === current || input.pathname.startsWith(`${current}/`))) {
    return `${base}/${input.nextEnvSlug}${input.pathname.slice(current.length)}`;
  }
  return `${base}/${input.nextEnvSlug}`;
}

export function useSwitchEnvironment(): (nextEnvSlug: string) => void {
  const navigate = useNavigate();
  const { orgSlug, projectSlug, envSlug } = useParams({ strict: false });
  return (nextEnvSlug) => {
    if (!orgSlug || !projectSlug) return;
    void navigate({
      to: switchedEnvironmentPath({
        pathname: window.location.pathname,
        orgSlug,
        projectSlug,
        currentEnvSlug: envSlug,
        nextEnvSlug,
      }),
    });
  };
}
