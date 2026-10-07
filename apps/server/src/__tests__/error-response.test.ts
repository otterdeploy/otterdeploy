/**
 * A rejection that reaches `app.onError` from a raw route answers a generic
 * typed body: the driver's own text stays in the request log.
 */
import { describe, expect, spyOn, test } from "bun:test";
import { createError, createRequestLogger } from "evlog";
import { type EvlogVariables } from "evlog/hono";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";

import { appErrorHandler } from "../error-response";

function appThrowing(error: unknown) {
  const logged: ReturnType<typeof spyOn>[] = [];
  const app = new Hono<EvlogVariables>();
  app.use(async (c, next) => {
    const log = createRequestLogger({ method: "TEST", path: "/" });
    logged.push(spyOn(log, "error"));
    c.set("log", log);
    await next();
  });
  app.get("/", () => {
    throw error;
  });
  app.onError(appErrorHandler);
  return { app, logged };
}

describe("appErrorHandler", () => {
  test("an unexpected error answers 500 without the driver's text, and is logged", async () => {
    const error = new Error(
      'Failed query: select "id" from "inbound_endpoint" where "token" = $1\nparams: whk_secret',
    );
    const { app, logged } = appThrowing(error);

    const response = await app.request("/");

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      code: "INTERNAL_SERVER_ERROR",
      message: "Internal server error",
    });
    expect(logged[0]).toHaveBeenCalledWith(error);
  });

  test("a deliberate 4xx keeps its status and message", async () => {
    const { app } = appThrowing(new HTTPException(413, { message: "Payload Too Large" }));

    const response = await app.request("/");

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ code: "HTTP_413", message: "Payload Too Large" });
  });

  test("a deliberate 5xx keeps its status but not its text", async () => {
    const { app } = appThrowing(
      createError({ message: "upstream read failed: ECONNREFUSED 10.0.0.9", status: 503 }),
    );

    const response = await app.request("/");

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      code: "INTERNAL_SERVER_ERROR",
      message: "Internal server error",
    });
  });
});
