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
 *  the caller by design, never leak cross-org existence). */
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

/**
 * Raised when a project delete is attempted while service/compose resources
 * still exist. Project delete tears down its databases itself, but service
 * runtimes (containers, built images, buildx caches, volumes) are only
 * reclaimed by the per-resource delete path. Deleting the rows underneath
 * them would orphan the runtime. Honest behavior: refuse and say why.
 */
export class ProjectHasServicesError extends TaggedError("ProjectHasServicesError")<{
  message: string;
  projectId: ProjectId;
  serviceCount: number;
}>() {
  constructor(args: { projectId: ProjectId; serviceCount: number }) {
    super({
      ...args,
      message: `project still has ${args.serviceCount} service${args.serviceCount === 1 ? "" : "s"}. Delete them first`,
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
 * Raised when a database still has live PR-preview branches.
 *
 * Under the `zfs` strategy a clone pins its origin snapshot, so the filesystem
 * would refuse the destroy anyway, but a raw ZFS error is unactionable, since
 * nothing in the UI connects a dataset to someone's open pull request. This
 * carries the PR numbers so the operator knows exactly what to close.
 */
export class DatabaseHasBranchesError extends TaggedError("DatabaseHasBranchesError")<{
  message: string;
  resourceId: string;
}>() {
  constructor(args: { resourceId: string; detail: string }) {
    super({
      resourceId: args.resourceId,
      message: args.detail,
    });
  }
}

/**
 * Raised for any operation that would recreate the CONTAINER of a database
 * that lives inside a shared server: restart, an env change, an extension
 * image swap. It has no container of its own, so the roll would restart its
 * host and take every other database on that server down with it.
 *
 * The honest answer is that these are host-level operations: run them on the
 * server, where the blast radius is visible, or give this database a dedicated
 * container.
 */
export class HostedDatabaseNotRollableError extends TaggedError("HostedDatabaseNotRollableError")<{
  message: string;
  resourceId: string;
}>() {
  constructor(args: { resourceId: string; name: string }) {
    super({
      resourceId: args.resourceId,
      message:
        `"${args.name}" runs inside a shared database server, so it has no container of ` +
        `its own to restart or re-roll. Do it on the server itself — it affects every ` +
        `database on it.`,
    });
  }
}

/**
 * Raised when public exposure is requested for a database inside a shared
 * server. The proxy's layer4 route maps one hostname to one upstream, and on a
 * shared server that upstream serves every tenant — so publishing one database
 * publishes the server, reachable with any tenant's credentials.
 */
export class HostedDatabaseNotPublishableError extends TaggedError(
  "HostedDatabaseNotPublishableError",
)<{
  message: string;
  resourceId: string;
}>() {
  constructor(args: { resourceId: string; name: string }) {
    super({
      resourceId: args.resourceId,
      message:
        `"${args.name}" runs inside a shared database server, which can't be exposed for one ` +
        `database at a time: the route would serve every database on that server. Move it to a ` +
        `dedicated container to publish it.`,
    });
  }
}

/**
 * Raised when a database server is deleted while logical databases still live
 * inside it. Deleting the container would take their data with it, and they
 * are separate resources — quite possibly in other projects — so the operator
 * has to decide what happens to each one rather than losing them as a side
 * effect of tearing down the server.
 */
export class DatabaseHasTenantsError extends TaggedError("DatabaseHasTenantsError")<{
  message: string;
  resourceId: string;
  tenants: string[];
}>() {
  constructor(args: { resourceId: string; tenants: string[] }) {
    super({
      resourceId: args.resourceId,
      tenants: args.tenants,
      message:
        `This server still hosts ${args.tenants.length} database` +
        `${args.tenants.length === 1 ? "" : "s"} (${args.tenants.join(", ")}). ` +
        `Delete or move them first.`,
    });
  }
}

/**
 * Raised when the requested extension set needs two different bundled
 * images (e.g. postgis + timescaledb): a single service runs a single
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
      message: `manifest was modified concurrently. Current server version is ${args.currentVersion}`,
    });
  }
}

/**
 * Per-resource skip during apply. Not a "fail the whole apply" error.
 * The reconciler keeps going and surfaces these in the `skipped[]`
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
