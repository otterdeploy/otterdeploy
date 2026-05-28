import { TaggedError } from "better-result";

import { ID_PREFIX, type Id } from "@otterstack/shared/id";

import { type ResourceId } from "../service/errors";

export type ProjectId = Id<typeof ID_PREFIX.project>;

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

/**
 * Raised when an updateProject payload references a git_repo or
 * container_registry row that doesn't exist in the requesting org.
 * Always an org-scope violation — the FK column is application-managed
 * so we have to verify cross-org access before writing.
 */
export class ProjectInvalidBindingError extends TaggedError(
  "ProjectInvalidBindingError",
)<{
  message: string;
  field: "gitRepoId" | "containerRegistryId";
}>() {
  constructor(args: { field: "gitRepoId" | "containerRegistryId" }) {
    super({
      field: args.field,
      message: `referenced ${args.field} doesn't belong to this organization`,
    });
  }
}

// ---------------------------------------------------------------------------
// Postgres resource lifecycle errors
// ---------------------------------------------------------------------------

export class PostgresResourceNotFoundError extends TaggedError(
  "PostgresResourceNotFoundError",
)<{
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

export class PostgresResourceConflictError extends TaggedError(
  "PostgresResourceConflictError",
)<{
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

// ---------------------------------------------------------------------------
// Manifest lifecycle errors
// ---------------------------------------------------------------------------

export class ManifestVersionConflictError extends TaggedError(
  "ManifestVersionConflictError",
)<{
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
  resource: "service" | "database" | "env";
  name: string;
  reason: string;
}>() {
  constructor(args: { resource: "service" | "database" | "env"; name: string; reason: string }) {
    super({
      ...args,
      message: `${args.resource} ${args.name} skipped: ${args.reason}`,
    });
  }
}
