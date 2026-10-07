/**
 * A raw route's error body carries only what was written for the
 * caller. The driver's own text (drizzle's "Failed query ... params", a socket
 * error naming the database host) never does.
 */
import { createError } from "evlog";
import { HTTPException } from "hono/http-exception";
import { describe, expect, it } from "vite-plus/test";

import { INTERNAL_ERROR_CODE, INTERNAL_ERROR_MESSAGE, publicError } from "../public-error";

const generic = { code: INTERNAL_ERROR_CODE, message: INTERNAL_ERROR_MESSAGE };

describe("publicError", () => {
  it("answers a generic typed 500 for an unexpected error, whatever its text", () => {
    const leaky = new Error(
      'Failed query: select "id" from "inbound_endpoint" where "token" = $1\nparams: whk_secret',
    );
    expect(publicError(leaky)).toEqual({ status: 500, body: generic });
    expect(publicError("connect ECONNREFUSED 10.0.0.5:5432")).toEqual({
      status: 500,
      body: generic,
    });
  });

  it("keeps a deliberate HTTPException 4xx and its message", () => {
    expect(publicError(new HTTPException(413, { message: "Payload Too Large" }))).toEqual({
      status: 413,
      body: { code: "HTTP_413", message: "Payload Too Large" },
    });
  });

  it("keeps a deliberate evlog 4xx with its why and fix", () => {
    const error = createError({
      message: "Service not found",
      status: 404,
      why: "no such id",
      fix: "check the id",
    });
    expect(publicError(error)).toEqual({
      status: 404,
      body: {
        code: "HTTP_404",
        message: "Service not found",
        why: "no such id",
        fix: "check the id",
      },
    });
  });

  it("keeps a deliberate 5xx status but never its text", () => {
    const error = createError({
      message: "registry read failed: ECONNREFUSED 10.0.0.9",
      status: 503,
    });
    expect(publicError(error)).toEqual({ status: 503, body: generic });
    expect(publicError(new HTTPException(502, { message: "upstream said: secret" }))).toEqual({
      status: 500,
      body: generic,
    });
  });
});
