import { TaggedError } from "better-result";

export type DomainErrorCode = "NOT_FOUND" | "CONFLICT" | "FORBIDDEN" | "BAD_REQUEST";

export class DomainError extends TaggedError("DomainError")<{
  code: DomainErrorCode;
  message: string;
  cause?: unknown;
}>() {
  constructor(code: DomainErrorCode, message: string, cause?: unknown) {
    super(cause === undefined ? { code, message } : { code, message, cause });
  }
}
