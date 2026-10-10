import type { JsonObject } from "@otterdeploy/shared/json";
import type { RequestLogger } from "evlog";

import { decryptSecret } from "@otterdeploy/jobs/delivery/secret-crypto";
/**
 * Inbound-endpoint invocation: the logic behind the public
 * `POST /api/webhooks/in/:token` route (mounted in apps/server). No session:
 * the caller authenticates with the endpoint's HMAC secret over
 * `<webhook-id>.<webhook-timestamp>.<raw body>` (`webhook-id`,
 * `webhook-timestamp`, `webhook-signature: v1,<base64>`; see
 * @otterdeploy/shared/webhook-signature), optionally narrowed by a source-IP
 * allowlist, and lightly rate-limited per token.
 *
 * Replay: a timestamp outside the tolerance window is refused,
 * and a `webhook-id` already accepted for this endpoint inside the window is
 * refused, so a captured request cannot re-trigger a deploy. The older
 * body-only `X-Otterdeploy-Signature` is refused outright: it signs no
 * timestamp, so nothing could tell its replay from a fresh call.
 *
 * Guard order (cheapest first, and nothing endpoint-specific leaks before the
 * token resolves): rate limit → token lookup → paused → IP allowlist →
 * signature + timestamp → replay → action. Every verified invocation stamps `lastInvokedAt` and
 * emits an audit record via the request logger.
 *
 * `redeploy` runs the exact same primitive the panel's Redeploy button uses.
 * `redeployAndFanOut` (routers/service/redeploy.ts), so an inbound trigger
 * can never behave differently from a UI redeploy.
 */
import { Temporal } from "@otterdeploy/shared/temporal";
import {
  WEBHOOK_ID_HEADER,
  WEBHOOK_SIGNATURE_HEADER,
  WEBHOOK_TIMESTAMP_HEADER,
  verifyWebhook,
} from "@otterdeploy/shared/webhook-signature";
import { Result } from "better-result";

import { redeployAndFanOut } from "../service/redeploy";
import { createRateLimiter, isIpAllowed } from "./inbound-guard";
import { claimInboundDelivery, type InboundReplayGuard } from "./inbound-replay";
import { getInboundByToken, touchInboundInvokedAt } from "./queries";
import { SIGNATURE_HEADER } from "./signature";

export { SIGNATURE_HEADER, WEBHOOK_ID_HEADER, WEBHOOK_SIGNATURE_HEADER, WEBHOOK_TIMESTAMP_HEADER };

export interface InboundRequest {
  token: string;
  /** The `webhook-id`, `webhook-timestamp` and `webhook-signature` headers. */
  webhookId: string | null;
  webhookTimestamp: string | null;
  webhookSignature: string | null;
  /** Value of the older X-Otterdeploy-Signature header, if any: only to
   *  explain the refusal to a caller still sending it. */
  signatureHeader: string | null;
  /** Raw request bytes: signature verification needs the exact body. */
  rawBody: ArrayBuffer;
  /** Best-effort caller IP (XFF first hop or socket address). */
  ip: string | null;
  log: RequestLogger;
}

export interface InboundResponse {
  status: 200 | 401 | 403 | 404 | 409 | 429 | 502 | 503;
  body: { ok: boolean; action?: string; service?: string; error?: string };
}

// 60 invocations/minute per token: protects the control plane from a
// misfiring CI loop; module-level so it spans requests within the process.
const limiter = createRateLimiter({ limit: 60, windowMs: 60_000 });

function deny(
  log: RequestLogger,
  status: InboundResponse["status"],
  reason: string,
  fields: JsonObject,
): InboundResponse {
  log.set({ webhookInbound: { outcome: "denied", reason, ...fields } });
  // Inbound calls carry no session. The actor is the external caller,
  // identified by the endpoint token (masked in `fields` for the log line).
  log.audit?.deny(reason, {
    action: "webhooks.inbound.invoke",
    actor: { type: "api" as const, id: "inbound-webhook" },
  });
  return { status, body: { ok: false, error: reason } };
}

export interface InboundDeps {
  replayGuard: InboundReplayGuard;
  /** The receiver's clock, unix seconds. */
  nowSeconds: () => number;
}

const defaultDeps: InboundDeps = {
  replayGuard: claimInboundDelivery,
  nowSeconds: () => Math.floor(Temporal.Now.instant().epochMilliseconds / 1000),
};

/**
 * Signature, timestamp window and single use. Null when the call may proceed,
 * otherwise the refusal to answer with.
 */
async function authenticate(
  req: InboundRequest,
  endpoint: { id: string; encryptedSecret: string },
  deps: InboundDeps,
): Promise<InboundResponse | null> {
  const { log } = req;
  if (!req.webhookSignature && req.signatureHeader) {
    return deny(
      log,
      401,
      `X-Otterdeploy-Signature is no longer accepted: it signs no timestamp, so a captured request could be replayed. Sign "<webhook-id>.<webhook-timestamp>.<body>" and send ${WEBHOOK_ID_HEADER}, ${WEBHOOK_TIMESTAMP_HEADER} and ${WEBHOOK_SIGNATURE_HEADER}`,
      { endpointId: endpoint.id },
    );
  }

  const secret = await decryptSecret(endpoint.encryptedSecret);
  const verified = await verifyWebhook(secret, {
    id: req.webhookId,
    timestamp: req.webhookTimestamp,
    signature: req.webhookSignature,
    body: req.rawBody,
    nowSeconds: deps.nowSeconds(),
  });
  if (!verified.ok) {
    return deny(log, 401, verified.message, { endpointId: endpoint.id, reason: verified.reason });
  }

  // Signed and fresh; now make it single-use. Claimed only after the
  // signature holds, so nobody without the secret can burn an id.
  const claimed = await Result.tryPromise({
    try: () => deps.replayGuard(endpoint.id, verified.id),
    catch: (cause) => (cause instanceof Error ? cause.message : String(cause)),
  });
  if (claimed.isErr()) {
    log.set({ webhookInbound: { replayGuardError: claimed.error } });
    return deny(log, 503, "replay protection is unavailable, try again", {
      endpointId: endpoint.id,
    });
  }
  if (!claimed.value) {
    return deny(log, 409, "this webhook-id was already delivered", { endpointId: endpoint.id });
  }
  return null;
}

export async function handleInboundInvocation(
  req: InboundRequest,
  deps: InboundDeps = defaultDeps,
): Promise<InboundResponse> {
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

  const refused = await authenticate(req, endpoint, deps);
  if (refused) return refused;

  // Verified: the invocation counts from here even if the action fails.
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

  // Destructured to consts so the null-check narrowing survives into the
  // `Result.tryPromise` closure below (narrowing on `ctx.*` would not).
  const { service, projectId, projectSlug } = ctx;
  if (!service || !projectId || !projectSlug) {
    // Bound service was deleted (FK SET NULL) or never set, record only.
    return {
      status: 200,
      body: { ok: true, action: "none", error: "no service bound to this endpoint" },
    };
  }

  const redeployed = await Result.tryPromise({
    try: () => redeployAndFanOut(projectId, service.resourceId, projectSlug, log),
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

  return { status: 200, body: { ok: true, action: "redeploy", service: service.resourceName } };
}

/** First 6 chars of the token for logs: enough to correlate, useless to replay. */
function mask(token: string): string {
  return `${token.slice(0, 6)}…`;
}
