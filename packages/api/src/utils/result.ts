import { ORPCError } from "@orpc/server";
import { DomainError } from "@otterstack/domain";
import { Result } from "better-result";

export function toORPCError(err: unknown) {
  if (err instanceof ORPCError) {
    return err;
  }

  if (err instanceof DomainError) {
    return new ORPCError(err.code, { message: err.message });
  }

  if (err instanceof Error) {
    return new ORPCError("INTERNAL_SERVER_ERROR", { message: err.message });
  }

  return new ORPCError("INTERNAL_SERVER_ERROR", {
    message: "Unknown internal error",
  });
}

export async function fromPromise<T>(promise: Promise<T>): Promise<T> {
  const result = await Result.tryPromise({
    try: () => promise,
    catch: toORPCError,
  });

  return result.match({
    ok: (value) => value,
    err: (error) => {
      throw error;
    },
  });
}
