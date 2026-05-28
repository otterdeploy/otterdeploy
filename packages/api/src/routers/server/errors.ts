import { TaggedError } from "better-result";

import { type Id, ID_PREFIX } from "@otterdeploy/shared/id";

export type ServerId = Id<typeof ID_PREFIX.server>;

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
