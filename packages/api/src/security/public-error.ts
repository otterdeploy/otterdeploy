/**
 * What a raw (non-oRPC) HTTP route may tell its caller about a failure.
 *
 * oRPC sanitizes an unexpected error to "Internal server error" on its own; a
 * Hono route that lets a rejection reach `app.onError` does not, so the
 * driver's own text (drizzle's "Failed query: <sql> params: <values>", which
 * carried a webhook token to an unauthenticated caller, a socket error naming
 * the database host) went out verbatim.
 *
 * The rule: only an error that was MADE for the caller is shown to the caller,
 * and only when it is the caller's problem (4xx): an `HTTPException` a
 * middleware threw on purpose, or an evlog `createError` with a 4xx status.
 * Everything else, and every 5xx, is the same generic typed body; the details
 * stay in the server-side log, which `app.onError` writes first.
 */
import { omitUndefined } from "@otterdeploy/shared/object";
import { EvlogError } from "evlog";
import { HTTPException } from "hono/http-exception";

export const INTERNAL_ERROR_CODE = "INTERNAL_SERVER_ERROR";
export const INTERNAL_ERROR_MESSAGE = "Internal server error";

export interface PublicErrorBody {
  code: string;
  message: string;
  why?: string;
  fix?: string;
}

export interface PublicError {
  status: number;
  body: PublicErrorBody;
}

/** The status and body a raw route answers for `error`. Pure and total. */
export function publicError(error: unknown): PublicError {
  if (error instanceof HTTPException && error.status < 500) {
    return {
      status: error.status,
      body: { code: `HTTP_${error.status}`, message: error.message },
    };
  }
  if (error instanceof EvlogError && error.status >= 400 && error.status < 500) {
    return {
      status: error.status,
      body: omitUndefined({
        code: error.code ?? `HTTP_${error.status}`,
        message: error.message,
        why: error.why,
        fix: error.fix,
      }),
    };
  }
  // A deliberate 5xx keeps its status (a 503 still says "try later"), never
  // its text: a 5xx message is usually built from a lower layer's error.
  const status = error instanceof EvlogError && error.status >= 500 ? error.status : 500;
  return { status, body: { code: INTERNAL_ERROR_CODE, message: INTERNAL_ERROR_MESSAGE } };
}
