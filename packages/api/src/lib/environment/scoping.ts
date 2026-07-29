/**
 * Runtime scoping — the naming rules that let a preview, or a non-main
 * environment, run a service (and reach it on a domain) ALONGSIDE production
 * without colliding. Pure functions, no IO, so they're trivially testable and
 * shared by the runtime spec builder (scoped container name) and the
 * expose/domain chain (scoped host label).
 *
 * Three scopes, one rule each:
 *
 *   base         — no suffix. The names every existing deployment already has.
 *   environment  — `-<slug>`, EXCEPT the project's main environment, which
 *                  renders as base (see below).
 *   preview      — `-pr-<n>`, stable across pushes to the same PR.
 *
 * **The main environment renders as base, and that is load-bearing.** Once
 * resources carry an `environmentId`, production is an environment like any
 * other — so a rule of "every environment gets a suffix" would rename every
 * running container, volume and host the moment the backfill lands. Main is
 * therefore identity, and only additional environments take a suffix. The same
 * reasoning is why `base` returns the empty string rather than anything
 * "nicer": these functions define what already-deployed things are called.
 *
 * A preview is NOT an environment: it's a first-class row bound to
 * (project, repo, PR) — see the `preview` table. A preview belongs to an
 * environment (its base), but its naming is its own.
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

/** The subset of an `environment` row the scoping rules need. */
export interface EnvironmentScope {
  slug: string;
  /** True when this is the project's main environment (`project.environmentId`).
   *  Main renders as base so existing names never change — see the module note. */
  isMain: boolean;
}

/**
 * What a resource is being named for. `null`/`undefined` are accepted
 * everywhere and mean base, so every existing call site that passes "no
 * preview" keeps its exact behaviour.
 */
export type Scope =
  | { kind: "base" }
  | ({ kind: "environment" } & EnvironmentScope)
  | ({ kind: "preview" } & PreviewScope);

export const BASE: Scope = { kind: "base" };

/** Lift a preview row's scoping subset into a `Scope`. */
export function previewScope(preview: PreviewScope): Scope {
  return { kind: "preview", ...preview };
}

/** Lift an environment row's scoping subset into a `Scope`. */
export function environmentScope(environment: EnvironmentScope): Scope {
  return { kind: "environment", ...environment };
}

/**
 * Accepts either a `Scope` or a bare `PreviewScope`, so callers that already
 * hold a preview row's subset don't have to lift it first. A bare object with
 * no `kind` is a preview by construction — that is the only shape that ever
 * existed before the union.
 */
export type ScopeLike = Scope | PreviewScope | null | undefined;

function normalize(scope: ScopeLike): Scope {
  if (!scope) return BASE;
  return "kind" in scope ? scope : previewScope(scope);
}

/**
 * Short, DNS- and Docker-name-safe suffix identifying a scope's containers and
 * hosts. Empty for base and for the main environment — see the module note.
 */
export function scopeSuffix(scope: ScopeLike): string {
  const s = normalize(scope);
  switch (s.kind) {
    case "base":
      return "";
    case "environment":
      return s.isMain ? "" : `-${s.slug}`;
    case "preview":
      return `-pr-${s.prNumber}`;
  }
}

/**
 * Stable suffix identifying a preview. Kept as its own export because the DB
 * branch path names datasets and volumes from it directly.
 */
export function previewSlug(scope: PreviewScope): string {
  return `pr-${scope.prNumber}`;
}

/**
 * Runtime container/service name for a resource. Base name when unscoped;
 * `<base>-pr-<n>` inside a preview, or `<base>-<env>` in a non-main
 * environment, so it runs as a distinct container Caddy can route to
 * independently.
 */
export function runtimeServiceName(baseServiceName: string, scope: ScopeLike): string {
  return `${baseServiceName}${scopeSuffix(scope)}`;
}

/**
 * The generated host LABEL for a scoped service — e.g. `web-pr-123`, or
 * `web-staging`. The domain-resolution chain appends the project/base domain
 * (so the full host becomes `web-pr-123.<base>`). Base and main return the
 * label unchanged.
 */
export function previewHostLabel(baseLabel: string, scope: ScopeLike): string {
  return `${baseLabel}${scopeSuffix(scope)}`;
}
