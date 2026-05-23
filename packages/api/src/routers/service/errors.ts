import { TaggedError } from "better-result";

import { ID_PREFIX, type Id } from "@otterstack/shared/id";

export type ResourceId = Id<typeof ID_PREFIX.resource>;

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
