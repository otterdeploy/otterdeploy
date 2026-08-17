/**
 * Global request-body size cap, with sensible per-route overrides, applied
 * as one middleware ahead of every handler. Without this, ANY route:
 * `/rpc/*`, `/api/auth/*`, a webhook receiver: will happily buffer whatever
 * bytes a caller sends before validation ever runs, which is both a memory-
 * exhaustion DoS vector and (per the Hono/oRPC default) fully buffers the
 * body before the 413 a size check would otherwise produce.
 *
 * Mirrors hono's own `hono/body-limit` middleware (same fast Content-Length
 * check, same incremental fallback when the length is unknown/chunked) but
 * picks the limit dynamically per request path, so a single middleware
 * instance can enforce a small default everywhere while giving legitimate
 * bulk endpoints (source tarball uploads) the headroom they need. Without
 * layering multiple `bodyLimit()` instances that would all run on every
 * request and fight each other.
 */
import type { Context, MiddlewareHandler } from "hono";

import { HTTPException } from "hono/http-exception";

export interface BodyLimitRule {
  /** Matches when `c.req.path` starts with this prefix. First match wins,
   *  order rules from most to least specific. */
  prefix: string;
  maxBytes: number;
}

/** Generous default for JSON/RPC bodies (oRPC calls, better-auth, bulk env
 *  var / compose-YAML pastes): comfortably above any real payload in this
 *  app's contracts (the largest single field is a 100k-char SQL query; see
 *  packages/api/src/routers/database/contract.ts) while still being a real
 *  wall against a runaway or hostile body. */
export const DEFAULT_BODY_LIMIT_BYTES = 10 * 1024 * 1024; // 10 MiB

/** Hard cap on an uploaded source tarball: mirrors
 *  apps/server/src/handlers/upload/source.ts's own streaming enforcement
 *  (which owns the authoritative, precise check as bytes arrive). This
 *  constant is the single source of truth both places import, so the
 *  request-level gate and the handler's own cap can never drift apart. */
export const MAX_SOURCE_UPLOAD_BYTES = 100 * 1024 * 1024; // 100 MiB

/** GitHub webhook payloads are capped at 25MB upstream; inbound trigger
 *  webhooks are operator-configured and expected to be small, but share the
 *  prefix so neither needs its own rule. */
const MAX_WEBHOOK_BYTES = 25 * 1024 * 1024; // 25 MiB

export const CONTROL_PLANE_BODY_LIMIT_RULES: BodyLimitRule[] = [
  { prefix: "/api/services/", maxBytes: MAX_SOURCE_UPLOAD_BYTES }, // POST /:resourceId/source
  { prefix: "/api/webhooks/", maxBytes: MAX_WEBHOOK_BYTES },
];

export function resolveBodyLimitBytes(
  path: string,
  rules: BodyLimitRule[] = CONTROL_PLANE_BODY_LIMIT_RULES,
  defaultBytes: number = DEFAULT_BODY_LIMIT_BYTES,
): number {
  for (const rule of rules) {
    if (path.startsWith(rule.prefix)) return rule.maxBytes;
  }
  return defaultBytes;
}

/**
 * Hono middleware: rejects an oversized body with 413 as early as possible.
 * From `Content-Length` alone when present (no bytes read at all), or
 * incrementally as chunks arrive when it's absent/untrustworthy
 * (`Transfer-Encoding: chunked`), so an oversized body is never fully
 * buffered before being rejected.
 */
export function bodyLimitMiddleware(
  rules: BodyLimitRule[] = CONTROL_PLANE_BODY_LIMIT_RULES,
  defaultBytes: number = DEFAULT_BODY_LIMIT_BYTES,
): MiddlewareHandler {
  return async (c: Context, next) => {
    if (!c.req.raw.body) return next();

    const maxBytes = resolveBodyLimitBytes(c.req.path, rules, defaultBytes);
    const hasTransferEncoding = c.req.raw.headers.has("transfer-encoding");
    const contentLengthHeader = c.req.raw.headers.get("content-length");

    if (contentLengthHeader && !hasTransferEncoding) {
      const contentLength = Number.parseInt(contentLengthHeader, 10);
      if (Number.isFinite(contentLength) && contentLength > maxBytes) {
        throw new HTTPException(413, { message: "Payload Too Large" });
      }
      return next();
    }

    // No trustworthy Content-Length: enforce incrementally so we still
    // reject before the whole body is buffered, then hand a reconstructed
    // stream to the rest of the chain (same technique hono/body-limit uses).
    let size = 0;
    const chunks: Uint8Array[] = [];
    const reader = c.req.raw.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        throw new HTTPException(413, { message: "Payload Too Large" });
      }
      chunks.push(value);
    }
    // Annotated (not cast): `duplex` is required by the fetch spec for a
    // stream body but missing from the lib's RequestInit, so widen the
    // declaration instead of asserting the literal.
    const rebuiltInit: RequestInit & { duplex: "half" } = {
      body: new ReadableStream({
        start(controller) {
          for (const chunk of chunks) controller.enqueue(chunk);
          controller.close();
        },
      }),
      duplex: "half",
    };
    c.req.raw = new Request(c.req.raw, rebuiltInit);
    await next();
  };
}
