/**
 * Preview runtime scoping — the naming rules that let a PR preview run a
 * service (and reach it on a domain) ALONGSIDE production without colliding.
 * Pure functions, no IO, so they're trivially testable and shared by the
 * runtime spec builder (preview-scoped container name) and the expose/domain
 * chain (preview host label).
 *
 * A preview is NOT an environment: it's a first-class row bound to
 * (project, repo, PR) — see the `preview` table. Base (non-preview) deploys
 * use the base names verbatim, so every existing deploy is byte-identical;
 * only a preview scope adds a suffix.
 */
import type { PreviewId } from "@otterdeploy/shared/id";

/** The subset of a `preview` row the scoping rules need. */
export interface PreviewScope {
  id: PreviewId;
  /** Repo-qualified slug (`<repoSlug>-pr-<n>`) — names branch DBs/volumes so
   *  two repos in one project never collide on the same PR number. */
  slug: string;
  /** Drives the stable `pr-<n>` service-container/host suffix. */
  prNumber: number;
}

/**
 * Short, DNS- and Docker-name-safe suffix identifying a preview's service
 * containers and hosts. Stable across pushes to the same PR.
 */
export function previewSlug(scope: PreviewScope): string {
  return `pr-${scope.prNumber}`;
}

/**
 * Runtime container/service name for a resource. Base name when no preview
 * scope; `<base>-pr-<n>` inside a preview so it runs as a distinct container
 * that Caddy can route to independently.
 */
export function runtimeServiceName(
  baseServiceName: string,
  scope: PreviewScope | null | undefined,
): string {
  if (!scope) return baseServiceName;
  return `${baseServiceName}-${previewSlug(scope)}`;
}

/**
 * The generated host LABEL for a preview service — e.g. `web-pr-123`. The
 * domain-resolution chain appends the project/base domain (so the full host
 * becomes `web-pr-123.<base>`). No scope returns the base label unchanged.
 */
export function previewHostLabel(
  baseLabel: string,
  scope: PreviewScope | null | undefined,
): string {
  if (!scope) return baseLabel;
  return `${baseLabel}-${previewSlug(scope)}`;
}
