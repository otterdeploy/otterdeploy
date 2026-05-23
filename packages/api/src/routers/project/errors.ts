import { TaggedError } from "better-result";

import { ID_PREFIX, type Id } from "@otterstack/shared/id";

export type ProjectId = Id<typeof ID_PREFIX.project>;

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
