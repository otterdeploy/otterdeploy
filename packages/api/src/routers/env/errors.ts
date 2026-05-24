import { TaggedError } from "better-result";

import { type Id, ID_PREFIX } from "@otterstack/shared/id";

export type EnvironmentId = Id<typeof ID_PREFIX.environment>;

export class EnvironmentNotFoundError extends TaggedError(
  "EnvironmentNotFoundError",
)<{
  message: string;
  environmentId: EnvironmentId;
}>() {
  constructor(args: { environmentId: EnvironmentId }) {
    super({
      environmentId: args.environmentId,
      message: `environment ${args.environmentId} not found`,
    });
  }
}

export class EnvironmentConflictError extends TaggedError(
  "EnvironmentConflictError",
)<{
  message: string;
  slug: string;
}>() {
  constructor(args: { slug: string }) {
    super({
      slug: args.slug,
      message: `environment with slug "${args.slug}" already exists`,
    });
  }
}
