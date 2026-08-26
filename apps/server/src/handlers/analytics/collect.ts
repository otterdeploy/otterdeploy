/**
 * POST /a/c: the public collect endpoint. This handler only adapts the Hono
 * request (raw text body, resolved client IP, the three privacy headers) to
 * `handleCollect` and turns its status into an empty response.
 *
 * `handleCollect` already never throws; the Result boundary here is belt and
 * braces for the adapter itself (a failed body read, a header quirk). It
 * mirrors deploy-protection's `guard()` but logs via the GLOBAL `log`: this
 * route is registered above the evlog middleware (no per-request wide event
 * on the hot path), so `c.get("log")` — which guard() relies on — does not
 * exist here.
 */

import type { Context } from "hono";

import { handleCollect } from "@otterdeploy/api/analytics";
import { resolveClient } from "@otterdeploy/api/security/trusted-proxy";
import { Result } from "better-result";
import { log } from "evlog";

export async function handleCollectRequest(c: Context): Promise<Response> {
  const res = await Result.tryPromise({
    try: async () => {
      const body = await c.req.text();
      const client = resolveClient(c);
      return handleCollect({
        body,
        ip: client.ip === "unknown" ? null : client.ip,
        userAgent: c.req.header("user-agent") ?? null,
        gpc: c.req.header("sec-gpc") === "1",
        dnt: c.req.header("dnt") === "1",
      });
    },
    catch: (cause) => cause,
  });
  const status = res.match({
    ok: (r) => r.status,
    err: (cause) => {
      log.error({
        analytics: { ingest: "collect-adapter-failed" },
        error: cause instanceof Error ? cause.message : String(cause),
      });
      // Public endpoint: never leak an error to an arbitrary page.
      return 204;
    },
  });
  // A plain Response: hono's `c.body` overloads split contentful/contentless
  // status unions, and every branch here is an empty body anyway.
  return new Response(null, { status, headers: { "Cache-Control": "no-store" } });
}
