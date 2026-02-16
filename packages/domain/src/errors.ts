import { TaggedError } from "better-result";

export class NotFoundError extends TaggedError("NotFoundError")<{
  resource: string;
  id: string;
  message: string;
}>() {
  constructor(args: { resource: string; id: string }) {
    super({ ...args, message: `${args.resource} not found: ${args.id}` });
  }
}

export class ConflictError extends TaggedError("ConflictError")<{
  resource: string;
  detail: string;
  message: string;
}>() {
  constructor(args: { resource: string; detail: string }) {
    super({ ...args, message: `${args.resource} conflict: ${args.detail}` });
  }
}

export class ForbiddenError extends TaggedError("ForbiddenError")<{
  reason: string;
  message: string;
}>() {
  constructor(args: { reason: string }) {
    super({ ...args, message: args.reason });
  }
}

export class BadRequestError extends TaggedError("BadRequestError")<{
  field: string;
  message: string;
}>() {}

export type DomainError = NotFoundError | ConflictError | ForbiddenError | BadRequestError;
