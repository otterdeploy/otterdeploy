/**
 * Public inbound-webhook receiver: `POST /api/webhooks/in/:token`.
 *
 * No session auth (the route sits under the identify middleware's
 * `/api/webhooks/**` exclusion) — every request is verified per-source
 * instead: HMAC-SHA256 over the raw body against the endpoint's secret,
 * optional source-IP allowlist, light per-token rate limit. All of that plus
 * the action (redeploy the bound service via the same primitive the UI uses)
 * lives in @otterdeploy/api's `handleInboundInvocation`; this handler only
 * adapts the Hono request (raw bytes, caller IP, request logger) and maps the
 * result back to a JSON response.
 */
import type { EvlogVariables } from "evlog/hono";
import type { Context } from "hono";

import {
  SIGNATURE_HEADER,
  handleInboundInvocation,
} from "@otterdeploy/api/routers/webhooks/inbound";
import { getConnInfo } from "hono/bun";

/** Best-effort caller IP: first X-Forwarded-For hop (Caddy fronts the server
 * in production) falling back to the socket address in dev. */
function callerIp(c: Context<EvlogVariables>): string | null {
  const xff = c.req.header("x-forwarded-for");
  const first = xff?.split(",")[0]?.trim();
  if (first) return first;
  try {
    return getConnInfo(c).remote.address ?? null;
  } catch {
    return null;
  }
}

export const inboundWebhookHandler = async (c: Context<EvlogVariables>) => {
  const token = c.req.param("token");
  if (!token) return c.json({ ok: false, error: "missing token" }, 400);

  // Signature verification needs the exact bytes, not a re-serialized parse.
  const rawBody = await c.req.raw.arrayBuffer();

  const result = await handleInboundInvocation({
    token,
    signatureHeader: c.req.header(SIGNATURE_HEADER) ?? null,
    rawBody,
    ip: callerIp(c),
    log: c.get("log"),
  });

  return c.json(result.body, result.status);
};
