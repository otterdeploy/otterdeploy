import type { ProjectId, ResourceId } from "@otterdeploy/shared/id";
import type { RequestLogger } from "evlog";

import { decryptSecret } from "@otterdeploy/jobs/delivery/secret-crypto";
/**
 * Inbound-endpoint invocation — the logic behind the public
 * `POST /api/webhooks/in/:token` route (mounted in apps/server). No session:
 * the caller authenticates with the endpoint's HMAC secret over the raw body
 * (`X-Otterdeploy-Signature: sha256=<hex>`), optionally narrowed by a
 * source-IP allowlist, and lightly rate-limited per token.
 *
 * Guard order (cheapest first, and nothing endpoint-specific leaks before the
 * token resolves): rate limit → token lookup → paused → IP allowlist →
 * signature → action. Every verified invocation stamps `lastInvokedAt` and
 * emits an audit record via the request logger.
 *
 * `redeploy` runs the exact same primitive the panel's Redeploy button uses —
 * `redeployAndFanOut` (routers/service/redeploy.ts) — so an inbound trigger
 * can never behave differently from a UI redeploy.
 */
import { Result } from "better-result";

import { redeployAndFanOut } from "../service/redeploy";
import { createRateLimiter, isIpAllowed } from "./inbound-guard";
import { getInboundByToken, touchInboundInvokedAt } from "./queries";
import { SIGNATURE_HEADER, verifySignatureHeader } from "./signature";

export { SIGNATURE_HEADER };

export interface InboundRequest {
  token: string;
  /** Value of the X-Otterdeploy-Signature header, if any. */
  signatureHeader: string | null;
  /** Raw request bytes — signature verification needs the exact body. */
  rawBody: ArrayBuffer;
  /** Best-effort caller IP (XFF first hop or socket address). */
  ip: string | null;
  log: RequestLogger;
}

export interface InboundResponse {
  status: 200 | 401 | 403 | 404 | 429 | 502;
  body: { ok: boolean; action?: string; service?: string; error?: string };
}

// 60 invocations/minute per token — protects the control plane from a
// misfiring CI loop; module-level so it spans requests within the process.
const limiter = createRateLimiter({ limit: 60, windowMs: 60_000 });

function deny(
  log: RequestLogger,
  status: InboundResponse["status"],
  reason: string,
  fields: Record<string, unknown>,
): InboundResponse {
  log.set({ webhookInbound: { outcome: "denied", reason, ...fields } });
  // Inbound calls carry no session — the actor is the external caller,
  // identified by the endpoint token (masked in `fields` for the log line).
  log.audit?.deny(reason, {
    action: "webhooks.inbound.invoke",
    actor: { type: "api" as const, id: "inbound-webhook" },
  });
  return { status, body: { ok: false, error: reason } };
}

export async function handleInboundInvocation(req: InboundRequest): Promise<InboundResponse> {
  const { log } = req;

  if (!limiter.allow(req.token)) {
    return deny(log, 429, "rate limit exceeded", { token: mask(req.token) });
  }

  const ctx = await getInboundByToken(req.token);
  if (!ctx) {
    return deny(log, 404, "unknown endpoint", { token: mask(req.token) });
  }
  const { endpoint } = ctx;

  if (endpoint.status !== "active") {
    return deny(log, 403, "endpoint is paused", { endpointId: endpoint.id });
  }

  if (!isIpAllowed(req.ip, endpoint.ipAllowlist)) {
    return deny(log, 403, "source IP not in allowlist", { endpointId: endpoint.id, ip: req.ip });
  }

  const secret = await decryptSecret(endpoint.encryptedSecret);
  const verified = await verifySignatureHeader(secret, req.signatureHeader, req.rawBody);
  if (!verified) {
    return deny(log, 401, "invalid signature", { endpointId: endpoint.id });
  }

  // Verified — the invocation counts from here even if the action fails.
  await touchInboundInvokedAt(endpoint.id);
  log.set({
    webhookInbound: { endpointId: endpoint.id, name: endpoint.name, action: endpoint.action },
  });
  log.audit?.({
    action: "webhooks.inbound.invoke",
    actor: { type: "api", id: endpoint.id },
    outcome: "success",
  });

  if (endpoint.action !== "redeploy") {
    return { status: 200, body: { ok: true, action: "none" } };
  }

  if (!ctx.service || !ctx.projectId || !ctx.projectSlug) {
    // Bound service was deleted (FK SET NULL) or never set — record only.
    return {
      status: 200,
      body: { ok: true, action: "none", error: "no service bound to this endpoint" },
    };
  }

  const redeployed = await Result.tryPromise({
    try: () =>
      redeployAndFanOut(
        ctx.projectId as ProjectId,
        ctx.service?.resourceId as ResourceId,
        ctx.projectSlug as string,
        log,
      ),
    catch: (cause) => (cause instanceof Error ? cause.message : String(cause)),
  });
  const flattened = redeployed.isOk()
    ? redeployed.value.isOk()
      ? null
      : redeployed.value.error.message
    : redeployed.error;

  if (flattened !== null) {
    log.set({ webhookInbound: { redeployError: flattened } });
    return { status: 502, body: { ok: false, action: "redeploy", error: flattened } };
  }

  return { status: 200, body: { ok: true, action: "redeploy", service: ctx.service.resourceName } };
}

/** First 6 chars of the token for logs — enough to correlate, useless to replay. */
function mask(token: string): string {
  return `${token.slice(0, 6)}…`;
}
