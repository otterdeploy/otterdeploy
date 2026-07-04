/**
 * Environment runtime scoping — the naming rules that let a preview environment
 * run a service (and reach it on a domain) ALONGSIDE production without
 * colliding. Pure functions, no IO, so they're trivially testable and shared by
 * the runtime spec builder (env-scoped container name) and the expose/domain
 * chain (preview host label). See docs/designs/pr-previews.md §7.3/§7.4.
 *
 * Persistent envs (production/staging) use the base names verbatim — so every
 * existing deploy is byte-identical. Only `kind: "preview"` envs get a suffix.
 */
import type { EnvironmentId } from "@otterdeploy/shared/id";

/** The subset of an `environment` row the scoping rules need. */
export interface EnvScope {
  id: EnvironmentId;
  kind: "persistent" | "preview";
  slug: string;
  /** Set on preview envs; drives the stable `pr-<n>` suffix. */
  pullRequestNumber?: number | null;
}

export function isPreviewEnv(env: EnvScope | null | undefined): env is EnvScope {
  return !!env && env.kind === "preview";
}

/**
 * Short, DNS- and Docker-name-safe suffix identifying a preview env. Prefers the
 * PR number (`pr-123`) — stable across pushes to the same PR — falling back to
 * the env slug when a preview somehow lacks a PR number.
 */
export function previewSlug(env: EnvScope): string {
  return env.pullRequestNumber != null ? `pr-${env.pullRequestNumber}` : env.slug;
}

/**
 * Runtime container/service name for a resource in a given environment. Base
 * name for persistent envs; `<base>-<pr-slug>` for previews so the preview runs
 * as a distinct container that Caddy can route to independently.
 */
export function runtimeServiceName(
  baseServiceName: string,
  env: EnvScope | null | undefined,
): string {
  if (!isPreviewEnv(env)) return baseServiceName;
  return `${baseServiceName}-${previewSlug(env)}`;
}

/**
 * The generated host LABEL for a preview service — e.g. `web-pr-123`. The
 * domain-resolution chain appends the project/base domain (so the full host
 * becomes `web-pr-123.<base>`). Persistent envs return the base label unchanged.
 */
export function previewHostLabel(baseLabel: string, env: EnvScope | null | undefined): string {
  if (!isPreviewEnv(env)) return baseLabel;
  return `${baseLabel}-${previewSlug(env)}`;
}
