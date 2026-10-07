/**
 * The app-wide Hono error handler: what a raw (non-oRPC) route answers when a
 * rejection reaches `app.onError`.
 *
 * The full error (driver message, SQL, params) goes to the request's wide
 * event only; the caller gets `publicError`'s body: a deliberate 4xx's own
 * message, otherwise a generic typed INTERNAL_SERVER_ERROR. It
 * used to answer `parseError(error).message`, which handed drizzle's
 * "Failed query: ... params: <webhook token>" to unauthenticated callers.
 */
import type { ContentfulStatusCode } from "hono/utils/http-status";

import { publicError } from "@otterdeploy/api/security/public-error";
import { type EvlogVariables } from "evlog/hono";
import { type ErrorHandler } from "hono";

// Every status hono's `ContentfulStatusCode` names (except the type-only -1
// "unofficial" marker). Each literal is checked against the union, so a hono
// upgrade that changes the set fails compilation here instead of drifting.
const CONTENTFUL_STATUS_CODES: ReadonlySet<ContentfulStatusCode> = new Set([
  100, 102, 103, 200, 201, 202, 203, 206, 207, 208, 226, 300, 301, 302, 303, 305, 306, 307, 308,
  400, 401, 402, 403, 404, 405, 406, 407, 408, 409, 410, 411, 412, 413, 414, 415, 416, 417, 418,
  421, 422, 423, 424, 425, 426, 428, 429, 431, 451, 500, 501, 502, 503, 504, 505, 506, 507, 508,
  510, 511,
]);

function isContentfulStatusCode(status: number): status is ContentfulStatusCode {
  const codes: ReadonlySet<number> = CONTENTFUL_STATUS_CODES;
  return codes.has(status);
}

export const appErrorHandler: ErrorHandler<EvlogVariables> = (error, c) => {
  // The full error (driver message, SQL, params) goes to the server-side log
  // only; the caller gets publicError's body: a deliberate 4xx's own message,
  // otherwise a generic typed INTERNAL_SERVER_ERROR.
  c.get("log").error(error);
  const { status, body } = publicError(error);
  // A non-standard or bodyless status can't carry this JSON error body, so
  // those collapse to 500.
  return c.json(body, isContentfulStatusCode(status) ? status : 500);
};
