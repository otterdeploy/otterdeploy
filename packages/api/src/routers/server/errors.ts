import type { ServerId } from "@otterdeploy/shared/id";

import { TaggedError } from "better-result";

export class ServerNotFoundError extends TaggedError("ServerNotFoundError")<{
  message: string;
  serverId: ServerId;
}>() {
  constructor(args: { serverId: ServerId }) {
    super({
      serverId: args.serverId,
      message: `server ${args.serverId} not found`,
    });
  }
}

export class ServerConflictError extends TaggedError("ServerConflictError")<{
  message: string;
  host: string;
}>() {
  constructor(args: { host: string }) {
    super({
      host: args.host,
      message: `server with host "${args.host}" already registered in this organization`,
    });
  }
}

/**
 * An unexpected database failure while registering a server.
 *
 * Exists because `panic()` cannot be used from a `Result.tryPromise` catch
 * handler: the handler is required to RETURN an error, and better-result
 * replaces anything thrown there with an opaque
 * `Panic("Result.tryPromise catch handler threw")`. That discarded the real
 * Postgres error, so provisioning 500s carried no diagnostic at all. Carrying
 * the cause's message through as a value keeps it in the log.
 */
/** A readable one-liner for any thrown value, never "[object Object]", which
 *  would throw away the very detail this error exists to carry. */
function describeCause(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  if (cause == null) return "unknown error";
  if (typeof cause === "string") return cause;
  if (typeof cause === "object") {
    if ("message" in cause && typeof cause.message === "string" && cause.message.length > 0) {
      return cause.message;
    }
    try {
      return JSON.stringify(cause) ?? "unknown error";
    } catch {
      return "unserializable error";
    }
  }
  // Remaining primitives only, enumerated so nothing `unknown` reaches String().
  if (typeof cause === "number" || typeof cause === "boolean" || typeof cause === "bigint") {
    return String(cause);
  }
  return "unknown error";
}

export class ServerDatabaseError extends TaggedError("ServerDatabaseError")<{
  message: string;
  operation: string;
}>() {
  constructor(args: { operation: string; cause: unknown }) {
    super({
      operation: args.operation,
      message: `${args.operation}: unexpected database error: ${describeCause(args.cause)}`,
    });
  }
}

/** Provision auth must be exactly one of a managed key or a one-time password.
 *  Neither (nothing to auth with) and both (ambiguous) are rejected. */
export class ProvisionCredentialError extends TaggedError("ProvisionCredentialError")<{
  message: string;
}>() {
  constructor() {
    super({
      message: "provide exactly one SSH credential: a managed key or a one-time password",
    });
  }
}

/** Retry only applies to a run that actually failed. */
export class ProvisionNotFailedError extends TaggedError("ProvisionNotFailedError")<{
  message: string;
  serverId: ServerId;
}>() {
  constructor(args: { serverId: ServerId; status: string }) {
    super({
      serverId: args.serverId,
      message: `server ${args.serverId} is "${args.status}", not "failed". Nothing to retry`,
    });
  }
}

/** A password-provisioned server can't be retried: the password was one-time
 *  and never stored, so there's no credential left to reconnect with. */
export class ProvisionMissingCredentialError extends TaggedError(
  "ProvisionMissingCredentialError",
)<{
  message: string;
  serverId: ServerId;
}>() {
  constructor(args: { serverId: ServerId }) {
    super({
      serverId: args.serverId,
      message: `server ${args.serverId} has no stored SSH key to retry with (it was provisioned by one-time password)`,
    });
  }
}

/** Availability is a swarm scheduler concept. The plain-docker runtime has
 *  no node to drain/pause, so the mutation is refused instead of faked. */
export class SwarmUnavailableError extends TaggedError("SwarmUnavailableError")<{
  message: string;
}>() {
  constructor() {
    super({
      message: "node availability requires the Docker Swarm runtime (DEPLOY_RUNTIME=swarm)",
    });
  }
}

/** The server row exists but no swarm node's hostname matches it. E.g. the
 *  machine was registered via the join flow but never actually joined. */
export class SwarmNodeNotFoundError extends TaggedError("SwarmNodeNotFoundError")<{
  message: string;
  serverId: ServerId;
}>() {
  constructor(args: { serverId: ServerId }) {
    super({
      serverId: args.serverId,
      message: `no swarm node matches server ${args.serverId} by hostname`,
    });
  }
}

/** Docker refused or failed the node-update call (version conflict, daemon
 *  error, last-manager guard, …). Carries docker's message for the log. */
export class SwarmNodeUpdateError extends TaggedError("SwarmNodeUpdateError")<{
  message: string;
  serverId: ServerId;
}>() {
  constructor(args: { serverId: ServerId; cause: string }) {
    super({
      serverId: args.serverId,
      message: `swarm node update failed for server ${args.serverId}: ${args.cause}`,
    });
  }
}

/** Listing swarm nodes failed (daemon unreachable, API error). Read-side
 *  sibling of SwarmNodeUpdateError for the swarmNodes procedure. */
export class SwarmNodeListError extends TaggedError("SwarmNodeListError")<{
  message: string;
}>() {
  constructor(args: { cause: string }) {
    super({ message: `couldn't list swarm nodes: ${args.cause}` });
  }
}

/** Demoting this node would leave the swarm with zero managers. Refused,
 *  because a manager-less swarm can never promote one back. */
export class SwarmLastManagerError extends TaggedError("SwarmLastManagerError")<{
  message: string;
  serverId: ServerId;
}>() {
  constructor(args: { serverId: ServerId }) {
    super({
      serverId: args.serverId,
      message: `refusing to demote server ${args.serverId}: it is the swarm's last manager`,
    });
  }
}

/** The target is the current Raft leader. Demote is refused; promote
 *  another manager and let leadership move first. */
export class SwarmLeaderDemoteError extends TaggedError("SwarmLeaderDemoteError")<{
  message: string;
  serverId: ServerId;
}>() {
  constructor(args: { serverId: ServerId }) {
    super({
      serverId: args.serverId,
      message: `refusing to demote server ${args.serverId}: it is the swarm leader`,
    });
  }
}

/** Removal is down-only by design (no --force surface): removing a live node
 *  orphans its tasks. Carries the swarm-reported state for the message. */
export class SwarmNodeNotDownError extends TaggedError("SwarmNodeNotDownError")<{
  message: string;
  serverId: ServerId;
  state: string;
}>() {
  constructor(args: { serverId: ServerId; state: string }) {
    super({
      serverId: args.serverId,
      state: args.state,
      message: `refusing to remove server ${args.serverId} from the swarm: node state is "${args.state}", not "down"`,
    });
  }
}

/** Docker refused or failed the node-remove call. */
export class SwarmNodeRemoveError extends TaggedError("SwarmNodeRemoveError")<{
  message: string;
  serverId: ServerId;
}>() {
  constructor(args: { serverId: ServerId; cause: string }) {
    super({
      serverId: args.serverId,
      message: `swarm node removal failed for server ${args.serverId}: ${args.cause}`,
    });
  }
}
