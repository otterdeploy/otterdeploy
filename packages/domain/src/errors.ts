export type DomainErrorCode = "NOT_FOUND" | "CONFLICT" | "FORBIDDEN" | "BAD_REQUEST";

export class DomainError extends Error {
  constructor(
    public code: DomainErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "DomainError";
  }
}
