import { ORPCError } from "@orpc/server";
import type { Result } from "better-result";
import type { DomainError } from "@otterstack/domain";

/**
 * Unwraps a Result from a domain service call.
 * Returns the value on success, or throws an ORPCError mapped from the TaggedError on failure.
 */
export function unwrapResult<T>(result: Result<T, DomainError>): T {
  if (result.isOk()) return result.value;

  const error = result.error;

  switch (error._tag) {
    case "NotFoundError":
      throw new ORPCError("NOT_FOUND", { message: error.message });
    case "ConflictError":
      throw new ORPCError("CONFLICT", { message: error.message });
    case "ForbiddenError":
      throw new ORPCError("FORBIDDEN", { message: error.message });
    case "BadRequestError":
      throw new ORPCError("BAD_REQUEST", { message: error.message });
  }
}
