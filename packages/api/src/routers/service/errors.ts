
import type { ProxyRouteId, ResourceId } from "@otterdeploy/shared/id";
import { TaggedError } from "better-result";

// ---------------------------------------------------------------------------
// Service lifecycle errors
// ---------------------------------------------------------------------------

export class ServiceNotFoundError extends TaggedError("ServiceNotFoundError")<{
  message: string;
  resourceId: ResourceId;
}>() {
  constructor(args: { resourceId: ResourceId }) {
    super({
      resourceId: args.resourceId,
      message: `service ${args.resourceId} not found`,
    });
  }
}

export class ServiceConflictError extends TaggedError("ServiceConflictError")<{
  message: string;
  name: string;
}>() {
  constructor(args: { name: string }) {
    super({
      name: args.name,
      message: `service "${args.name}" already exists in this project`,
    });
  }
}

export class NoHttpPortError extends TaggedError("NoHttpPortError")<{
  message: string;
  resourceId: ResourceId;
}>() {
  constructor(args: { resourceId: ResourceId }) {
    super({
      resourceId: args.resourceId,
      message: `service ${args.resourceId} has no HTTP port to expose`,
    });
  }
}

export class ServiceInUseError extends TaggedError("ServiceInUseError")<{
  message: string;
  resourceId: ResourceId;
  referrers: ReadonlyArray<ResourceId>;
}>() {
  constructor(args: { resourceId: ResourceId; referrers: ReadonlyArray<ResourceId> }) {
    super({
      resourceId: args.resourceId,
      referrers: args.referrers,
      message: `service ${args.resourceId} is referenced by ${args.referrers.length} other service(s)`,
    });
  }
}

/**
 * Raised when creating a git-sourced service in a project that hasn't had
 * its git binding (gitRepoId + containerRegistryId + imageRepository) set
 * up yet. The wizard surface this as "configure source in Settings first".
 */
export class MissingProjectBuildBindingError extends TaggedError(
  "MissingProjectBuildBindingError",
)<{
  message: string;
  missing: ReadonlyArray<"gitRepoId" | "containerRegistryId" | "imageRepository">;
}>() {
  constructor(args: {
    missing: ReadonlyArray<"gitRepoId" | "containerRegistryId" | "imageRepository">;
  }) {
    super({
      missing: args.missing,
      message: `project is missing build binding: ${args.missing.join(", ")}`,
    });
  }
}

// ---------------------------------------------------------------------------
// Custom-domain errors
// ---------------------------------------------------------------------------

/** A domain the operator tried to add/edit is already routed (globally
 *  unique across the install). Surfaced as 409. */
export class DomainConflictError extends TaggedError("DomainConflictError")<{
  message: string;
  domain: string;
}>() {
  constructor(args: { domain: string }) {
    super({
      domain: args.domain,
      message: `domain "${args.domain}" is already in use`,
    });
  }
}

/** The route the caller named doesn't exist (or belongs to another
 *  resource/org). Surfaced as 404 — never leaks cross-tenant existence. */
export class DomainNotFoundError extends TaggedError("DomainNotFoundError")<{
  message: string;
  routeId: ProxyRouteId;
}>() {
  constructor(args: { routeId: ProxyRouteId }) {
    super({
      routeId: args.routeId,
      message: `domain route ${args.routeId} not found`,
    });
  }
}

// ---------------------------------------------------------------------------
// Variable reference errors (used by the resolver consumed by service env)
// ---------------------------------------------------------------------------

export class RefParseError extends TaggedError("RefParseError")<{
  message: string;
  key: string;
  position: number;
}>() {}

export class RefMissingResourceError extends TaggedError("RefMissingResourceError")<{
  message: string;
  refResourceName: string;
}>() {
  constructor(args: { refResourceName: string }) {
    super({
      refResourceName: args.refResourceName,
      message: `referenced resource "${args.refResourceName}" not found in this project`,
    });
  }
}

export class RefUnknownVarError extends TaggedError("RefUnknownVarError")<{
  message: string;
  refResourceName: string;
  refVarName: string;
}>() {
  constructor(args: { refResourceName: string; refVarName: string }) {
    super({
      refResourceName: args.refResourceName,
      refVarName: args.refVarName,
      message: `${args.refResourceName} does not export ${args.refVarName}`,
    });
  }
}

export class RefCycleError extends TaggedError("RefCycleError")<{
  message: string;
  chain: ReadonlyArray<string>;
}>() {
  constructor(args: { chain: ReadonlyArray<string> }) {
    super({
      chain: args.chain,
      message: `variable reference cycle: ${args.chain.join(" -> ")}`,
    });
  }
}

export type ResolveError =
  | RefParseError
  | RefMissingResourceError
  | RefUnknownVarError
  | RefCycleError;
