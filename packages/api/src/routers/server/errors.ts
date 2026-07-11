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

/** Provision auth must be exactly one of a managed key or a one-time password
 *  — neither (nothing to auth with) and both (ambiguous) are rejected. */
export class ProvisionCredentialError extends TaggedError("ProvisionCredentialError")<{
  message: string;
}>() {
  constructor() {
    super({
      message: "provide exactly one SSH credential — a managed key or a one-time password",
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
      message: `server ${args.serverId} is "${args.status}", not "failed" — nothing to retry`,
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

/** Availability is a swarm scheduler concept — the plain-docker runtime has
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

/** The server row exists but no swarm node's hostname matches it — e.g. the
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

/** Demoting this node would leave the swarm with zero managers — refused,
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

/** The target is the current Raft leader — demote is refused; promote
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
