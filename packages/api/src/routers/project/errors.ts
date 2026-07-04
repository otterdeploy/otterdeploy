import type { ProjectId, ProxyRouteId, ResourceId } from "@otterdeploy/shared/id";

import { TaggedError } from "better-result";

// ---------------------------------------------------------------------------
// Project lifecycle errors
// ---------------------------------------------------------------------------

export class ProjectNotFoundError extends TaggedError("ProjectNotFoundError")<{
  message: string;
  projectId: ProjectId;
}>() {
  constructor(args: { projectId: ProjectId }) {
    super({
      projectId: args.projectId,
      message: `project ${args.projectId} not found`,
    });
  }
}

/** Raised when a proxy-route mutation targets a route that doesn't exist
 *  or doesn't belong to the caller's org (the two are indistinguishable to
 *  the caller by design — never leak cross-org existence). */
export class ProxyRouteNotFoundError extends TaggedError("ProxyRouteNotFoundError")<{
  message: string;
  routeId: ProxyRouteId;
}>() {
  constructor(args: { routeId: ProxyRouteId }) {
    super({
      routeId: args.routeId,
      message: `proxy route ${args.routeId} not found`,
    });
  }
}

export class ProjectConflictError extends TaggedError("ProjectConflictError")<{
  message: string;
  slug: string;
}>() {
  constructor(args: { slug: string }) {
    super({
      slug: args.slug,
      message: `project with slug "${args.slug}" already exists`,
    });
  }
}


// ---------------------------------------------------------------------------
// Postgres resource lifecycle errors
// ---------------------------------------------------------------------------

export class PostgresResourceNotFoundError extends TaggedError("PostgresResourceNotFoundError")<{
  message: string;
  resourceId: ResourceId;
}>() {
  constructor(args: { resourceId: ResourceId }) {
    super({
      resourceId: args.resourceId,
      message: `postgres resource ${args.resourceId} not found`,
    });
  }
}

export class PostgresResourceConflictError extends TaggedError("PostgresResourceConflictError")<{
  message: string;
  name: string;
}>() {
  constructor(args: { name: string }) {
    super({
      name: args.name,
      message: `postgres resource "${args.name}" already exists in this project`,
    });
  }
}

/**
 * Raised when the requested extension set needs two different bundled
 * images (e.g. postgis + timescaledb) — a single service runs a single
 * image, so the combination is rejected rather than silently dropping one.
 */
export class IncompatibleExtensionsError extends TaggedError("IncompatibleExtensionsError")<{
  message: string;
  conflict: string[];
}>() {
  constructor(args: { conflict: string[] }) {
    super({
      conflict: args.conflict,
      message: `these extensions need different images and can't be combined: ${args.conflict.join(", ")}`,
    });
  }
}

// ---------------------------------------------------------------------------
// Manifest lifecycle errors
// ---------------------------------------------------------------------------

export class ManifestVersionConflictError extends TaggedError("ManifestVersionConflictError")<{
  message: string;
  currentVersion: number;
}>() {
  constructor(args: { currentVersion: number }) {
    super({
      currentVersion: args.currentVersion,
      message: `manifest was modified concurrently — current server version is ${args.currentVersion}`,
    });
  }
}

/**
 * Per-resource skip during apply. Not a "fail the whole apply" error —
 * the reconciler keeps going and surfaces these in the `skipped[]`
 * result so the operator can see which resources didn't reconcile and
 * why. Carries the resource kind + name to populate the wire shape.
 */
export class ManifestApplySkipError extends TaggedError("ManifestApplySkipError")<{
  message: string;
  resource: "service" | "database" | "env" | "compose";
  name: string;
  reason: string;
}>() {
  constructor(args: {
    resource: "service" | "database" | "env" | "compose";
    name: string;
    reason: string;
  }) {
    super({
      ...args,
      message: `${args.resource} ${args.name} skipped: ${args.reason}`,
    });
  }
}
