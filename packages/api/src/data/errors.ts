/**
 * Failure modes of the data runtime, as tagged errors rather than strings.
 *
 * The distinction that matters to the caller is *whose* fault a failure is:
 * `unreachable` and `timeout` are ours to retry, `denied` is a policy decision
 * to surface as-is, and `query` is the user's SQL and must carry the engine's
 * own message verbatim — a console that swallows the error text is useless.
 */
import { TaggedError } from "better-result";

export type DataErrorReason =
  /** No route to the database: container down, DNS gone, credentials wrong. */
  | "unreachable"
  /** The statement ran too long and was cancelled. */
  | "timeout"
  /** The engine rejected the statement. `message` is the engine's own text. */
  | "query"
  /** The connection is read-only, or the caller lacks the capability. */
  | "denied"
  /** The engine has no relational dialect (Redis, Mongo). */
  | "unsupported"
  /** The resource or connection does not exist for this organization. */
  | "not_found";

export class DataError extends TaggedError("DataError")<{
  reason: DataErrorReason;
  message: string;
}>() {}

export const dataError = (reason: DataErrorReason, message: string): DataError =>
  new DataError({ reason, message });

/**
 * Say WHICH database could not be reached.
 *
 * The driver's own words ("Connection closed", "Connection timeout after
 * 10s") name no host, and a workbench that shows five connections cannot
 * leave the reader to guess which one is unreachable. The label is the row's
 * name; the host is what we actually dialled (an external target is pinned
 * to its resolved address). Never the credentials. Query and policy errors
 * are left alone: they already come with the engine's or our own context.
 */
export function describeUnreachable(
  error: DataError,
  target: { label: string; host: string; port: number },
): DataError {
  if (error.reason !== "unreachable" && error.reason !== "timeout") return error;
  return dataError(
    error.reason,
    `${target.label} (${target.host}:${target.port}): ${error.message}`,
  );
}

/**
 * Normalise a thrown driver value into a {@link DataError}.
 *
 * Bun's SQL driver throws `Error`s whose message carries the server's text; a
 * connection failure is distinguishable only by its code or its wording, so
 * both are checked. Anything unrecognised is reported as a query error with the
 * message intact, because losing the engine's own words is worse than
 * mislabelling the category.
 */
export function toDataError(cause: unknown): DataError {
  const message = cause instanceof Error ? cause.message : String(cause);
  const code = readErrorCode(cause);

  if (code === "ECONNREFUSED" || code === "ENOTFOUND" || code === "EHOSTUNREACH") {
    return dataError("unreachable", message);
  }
  if (code === "ETIMEDOUT" || /timeout|timed out|statement_timeout/i.test(message)) {
    return dataError("timeout", message);
  }
  if (/read-only|read only transaction|permission denied|access denied/i.test(message)) {
    return dataError("denied", message);
  }
  if (/connect|connection|ECONNRESET|getaddrinfo/i.test(message) && code !== undefined) {
    return dataError("unreachable", message);
  }
  return dataError("query", message);
}

/** Read a Node-style `code` off a thrown value without asserting its shape. */
function readErrorCode(cause: unknown): string | undefined {
  if (typeof cause !== "object" || cause === null) return undefined;
  if (!("code" in cause)) return undefined;
  const { code } = cause;
  return typeof code === "string" ? code : undefined;
}
