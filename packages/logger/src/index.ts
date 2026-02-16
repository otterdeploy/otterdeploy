import pino from "pino";
import PinoPretty from "pino-pretty";
import type { MiddlewareHandler } from "hono";

import { REDACT_PATHS } from "./redact";

export { sanitizeForLog, REDACT_PATHS } from "./redact";

export function createLogger(name: string) {
  const isDev = process.env.NODE_ENV !== "production";

  const options: pino.LoggerOptions = {
    name,
    level: process.env.LOG_LEVEL ?? (isDev ? "debug" : "info"),
    base: { service: name, version: "0.1.0" },
    redact: {
      paths: [...REDACT_PATHS],
      censor: "[REDACTED]",
    },
  };

  if (isDev) {
    return pino(options, PinoPretty({ colorize: true }));
  }

  return pino(options);
}

export function createRequestLogger(): MiddlewareHandler {
  const log = createLogger("http");

  return async (c, next) => {
    const correlationId =
      c.req.header("x-request-id") ?? crypto.randomUUID();

    c.set("correlationId", correlationId);

    const start = Date.now();
    const method = c.req.method;
    const path = c.req.path;

    log.info({ correlationId, method, path }, "request started");

    await next();

    const duration = Date.now() - start;
    const status = c.res.status;

    log.info(
      { correlationId, method, path, status, duration },
      "request completed",
    );
  };
}
