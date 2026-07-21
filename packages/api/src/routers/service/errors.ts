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

/**
 * Raised when enabling public exposure on a service that has no real domain —
 * the only host we could resolve is the throwaway `<slug>.<ip>.sslip.io`
 * fallback. Rather than silently publish the service on that URL, expose
 * refuses and hands back the host it *would* have minted so the UI can ask the
 * operator to explicitly opt in (re-calling with `allowGeneratedDomain`).
 */
export class NoPublicDomainError extends TaggedError("NoPublicDomainError")<{
  message: string;
  resourceId: ResourceId;
  generatedDomain: string;
}>() {
  constructor(args: { resourceId: ResourceId; generatedDomain: string }) {
    super({
      resourceId: args.resourceId,
      generatedDomain: args.generatedDomain,
      message: `service ${args.resourceId} has no domain; refusing to auto-expose on ${args.generatedDomain} without opt-in`,
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
 * The deployment a rollback targets can't be rolled back to — it's still
 * building/failed (no live image), or its image is a `pending:` placeholder
 * from a build that never produced an artifact.
 */
export class NotRollbackableError extends TaggedError("NotRollbackableError")<{
  message: string;
  resourceId: ResourceId;
}>() {
  constructor(args: { resourceId: ResourceId; reason: string }) {
    super({
      resourceId: args.resourceId,
      message: `deployment can't be rolled back to: ${args.reason}`,
    });
  }
}

/**
 * Raised when creating a git-sourced service without a git repo binding on
 * the service itself (each service owns its own repo now). The wizard surfaces
 * this as "pick a repo for this service first". Registry/image are optional
 * (the builder falls back to a registry-less local build), so only the repo
 * gates creation.
 */
export class MissingServiceBuildBindingError extends TaggedError(
  "MissingServiceBuildBindingError",
)<{
  message: string;
  missing: ReadonlyArray<"gitRepoId">;
}>() {
  constructor(args: { missing: ReadonlyArray<"gitRepoId"> }) {
    super({
      missing: args.missing,
      message: `service is missing git repo binding: ${args.missing.join(", ")}`,
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
