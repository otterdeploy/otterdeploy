import { db } from "@otterdeploy/db";
import { webhook, webhookDelivery } from "@otterdeploy/db/schema";
/**
 * Outbound webhook pipeline: two jobs:
 *
 *   webhook.event: fan-out. One per platform event (enqueued from
 *     `triggerPlatformEvent` alongside the notification fan-out). Resolves
 *     every ACTIVE webhook in the org whose `events` array contains the
 *     event id and enqueues one `webhook.deliver` per match, so each target
 *     gets its own retry cycle and one dead endpoint can't stall the rest.
 *
 *   webhook.deliver: a single POST to a single webhook. Signs each attempt
 *     with the webhook's (decrypted) secret (`webhookRequestHeaders` below):
 *     `webhook-id` / `webhook-timestamp` / `webhook-signature` over
 *     id.timestamp.body, so a receiver can refuse a replayed or stale delivery,
 *     plus the older body-only `X-Otterdeploy-Signature`
 *     for receivers that already verify it. 10s timeout, and writes ONE
 *     `webhook_delivery` row PER ATTEMPT (status code, ok, attempt #,
 *     latency, error). On failure it throws so BullMQ retries with
 *     exponential backoff (5 attempts); every attempt is already recorded by
 *     the time the throw happens. A 410 Gone is final: the receiver said the
 *     endpoint is gone, so it is not retried.
 *
 *     `target.url` is entirely tenant-supplied. The POST goes through the
 *     shared egress policy (`deliverWebhookHttp` below), which resolves and
 *     validates every address (loopback/private/link-local/metadata ranges
 *     and the control plane's own identity denied by default), pins the
 *     connection to the validated address, and re-validates every redirect
 *     hop. A denied target fails exactly like any other delivery failure.
 *     Recorded as a `webhook_delivery` row with a clear error, so it never
 *     silently no-ops. See packages/shared/src/egress-policy.ts.
 */
import { hmacSha256Hex } from "@otterdeploy/shared/crypto";
import { EgressPolicyError, egressFetch } from "@otterdeploy/shared/egress-policy";
import { hasPrefix, ID_PREFIX, type OrganizationId } from "@otterdeploy/shared/id";
import { Temporal } from "@otterdeploy/shared/temporal";
import { webhookSignatureHeaders } from "@otterdeploy/shared/webhook-signature";
import { UnrecoverableError } from "bullmq";
import { and, arrayOverlaps, eq } from "drizzle-orm";
import * as z from "zod";

import { defineJob } from "../define";
import { controlPlaneEgressDenylist, egressAllowlist } from "../delivery/egress-denylist";
import { decryptSecret } from "../delivery/secret-crypto";
import { subscriberEventIds } from "../delivery/subscribed-events";

/** Body-only HMAC, kept for receivers that already verify it. It signs no
 *  timestamp, so it cannot tell a replay from a delivery: new receivers verify
 *  `webhook-signature` instead. */
const LEGACY_SIGNATURE_HEADER = "X-Otterdeploy-Signature";
const DELIVERY_TIMEOUT_MS = 10_000;
const DELIVERY_MAX_RESPONSE_BYTES = 1024 * 1024;

export interface WebhookDeliveryOutcome {
  statusCode: number | null;
  error: string | null;
}

/**
 * Performs the guarded outbound POST for one webhook delivery attempt.
 * Isolated from the job handler (DB/BullMQ) so it's directly unit-testable:
 * a denied target resolves to `{ statusCode: null, error: <clear message> }`.
 * Fails closed, never throws past this function, exactly like any other
 * delivery failure the caller records.
 */
export async function deliverWebhookHttp(input: {
  url: string;
  body: string;
  headers: Record<string, string>;
  timeoutMs?: number;
  denyHosts?: Iterable<string>;
  denyAddresses?: Iterable<string>;
  allowAddresses?: Iterable<string>;
}): Promise<WebhookDeliveryOutcome> {
  try {
    const res = await egressFetch(
      input.url,
      { method: "POST", headers: input.headers, body: input.body },
      {
        // Webhook receivers are commonly plain http (local/dev tooling,
        // internal reverse proxies without TLS): the tenant already chose
        // the scheme when they registered the URL; the egress policy's
        // address checks are the actual SSRF defense, not the scheme.
        allowHttp: true,
        timeoutMs: input.timeoutMs ?? DELIVERY_TIMEOUT_MS,
        maxBytes: DELIVERY_MAX_RESPONSE_BYTES,
        maxRedirects: 5,
        denyHosts: input.denyHosts,
        denyAddresses: input.denyAddresses,
        allowAddresses: input.allowAddresses,
      },
    );
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return {
        statusCode: res.status,
        error: `HTTP ${res.status}${text ? `: ${text.slice(0, 200)}` : ""}`,
      };
    }
    // Drain/discard the body on success so the socket is released.
    await res.arrayBuffer().catch(() => undefined);
    return { statusCode: res.status, error: null };
  } catch (err) {
    if (err instanceof EgressPolicyError) {
      // Blocked before a socket ever opened. Fail closed with an
      // unambiguous, operator-readable reason instead of a generic network
      // error.
      return { statusCode: null, error: `blocked by outbound egress policy: ${err.message}` };
    }
    const error =
      err instanceof Error
        ? err.name === "TimeoutError"
          ? `timeout after ${input.timeoutMs ?? DELIVERY_TIMEOUT_MS}ms`
          : err.message
        : String(err);
    return { statusCode: null, error };
  }
}

/** The error a failed attempt throws: retried by BullMQ, except a 410 Gone,
 *  where the receiver said the endpoint is retired and retrying cannot help. */
export function deliveryFailure(statusCode: number | null, error: string): Error {
  const message = `webhook delivery failed: ${error}`;
  return statusCode === 410 ? new UnrecoverableError(message) : new Error(message);
}

/**
 * Headers for one delivery attempt. `deliveryId` is the message id, the same on
 * every retry so a receiver can de-duplicate; `timestamp` is this attempt's
 * signing time, so each retry is signed afresh and stays inside the
 * receiver's tolerance window.
 */
export async function webhookRequestHeaders(input: {
  secret: string;
  body: string;
  event: string;
  deliveryId: string;
  timestamp: number;
}): Promise<Record<string, string>> {
  return {
    "content-type": "application/json",
    "user-agent": "otterdeploy-webhooks/1",
    ...(await webhookSignatureHeaders(input.secret, {
      id: input.deliveryId,
      timestamp: input.timestamp,
      body: input.body,
    })),
    [LEGACY_SIGNATURE_HEADER]: `sha256=${await hmacSha256Hex(input.secret, input.body)}`,
    "X-Otterdeploy-Event": input.event,
    "X-Otterdeploy-Delivery": input.deliveryId,
  };
}

export const WebhookEventPayload = z.object({
  organizationId: z.string().min(1),
  eventId: z.string().min(1),
  severity: z.enum(["info", "ok", "warn", "err"]).default("info"),
  title: z.string().min(1),
  message: z.string().default(""),
  data: z.record(z.string(), z.string()).optional(),
});
export type WebhookEventPayload = z.infer<typeof WebhookEventPayload>;

export const WebhookDeliveryPayload = z.object({
  organizationId: z.string().min(1),
  webhookId: z.string().min(1),
  event: z.string().min(1),
  /** The exact JSON object that will be serialized, signed, and POSTed.
   * `z.json()` values (not `z.unknown()`) so the inferred type stays
   * JSON-shaped and flows into the `webhook_delivery.payload` jsonb column. */
  body: z.record(z.string(), z.json()),
});
export type WebhookDeliveryPayload = z.infer<typeof WebhookDeliveryPayload>;

// Job payloads carry IDs as plain strings (BullMQ JSON); columns are branded.
// `hasPrefix` re-brands them in the handlers: an ID without its entity prefix
// can't match any row, so the guard's false branch takes the same no-match
// exit the query would have.

/** The wire format receivers get. Kept flat and stable. It's an API.
 * (A type alias, not an interface, so it keeps the implicit index signature
 * that lets it flow into `WebhookDeliveryPayload["body"]`.) */
// oxlint-disable-next-line typescript/consistent-type-definitions
export type WebhookBody = {
  event: string;
  severity: WebhookEventPayload["severity"];
  title: string;
  message: string;
  data: Record<string, string>;
  timestamp: string;
};

export function buildWebhookBody(payload: WebhookEventPayload): WebhookBody {
  return {
    event: payload.eventId,
    severity: payload.severity,
    title: payload.title,
    message: payload.message,
    data: payload.data ?? {},
    timestamp: new Date().toISOString(),
  };
}

/**
 * Active webhooks in the org subscribed to the event or to an event it is a
 * kind of (../delivery/subscribed-events.ts). One row per webhook, so a hook
 * subscribed to both ids still gets one delivery.
 */
function subscribedWebhooks(organizationId: OrganizationId, eventId: string) {
  return db
    .select({ id: webhook.id })
    .from(webhook)
    .where(
      and(
        eq(webhook.organizationId, organizationId),
        eq(webhook.status, "active"),
        arrayOverlaps(webhook.events, subscriberEventIds(eventId)),
      ),
    );
}

export const webhookEventJob = defineJob({
  name: "webhook.event",
  schema: WebhookEventPayload,
  opts: {
    attempts: 3,
    backoff: { type: "exponential", delay: 1000 },
    removeOnComplete: { age: 60 * 60 * 24 },
    removeOnFail: { age: 60 * 60 * 24 * 7 },
  },
  async handler(payload, { log }) {
    const orgId = payload.organizationId;
    if (!hasPrefix(orgId, ID_PREFIX.organization)) {
      // No org row can carry this ID, so the fan-out below would match zero
      // webhooks anyway. Same outcome, minus the round trip.
      return { eventId: payload.eventId, enqueued: 0 };
    }
    const subscribed = await subscribedWebhooks(orgId, payload.eventId);

    log.info({
      webhook: { step: "fanout", eventId: payload.eventId, targets: subscribed.length },
    });
    if (subscribed.length === 0) return { eventId: payload.eventId, enqueued: 0 };

    const body = buildWebhookBody(payload);
    // Lazy import: `queues.ts` imports the registry, and this file is part of
    // the registry: a top-level import here is a module cycle that leaves the
    // webhook job entries undefined during registry evaluation.
    const { getQueue } = await import("../queues");
    const queue = getQueue(webhookDeliverJob.name);
    await queue.addBulk(
      subscribed.map((w) => ({
        name: webhookDeliverJob.name,
        data: {
          organizationId: payload.organizationId,
          webhookId: w.id,
          event: payload.eventId,
          body,
        } satisfies WebhookDeliveryPayload,
        opts: webhookDeliverJob.opts,
      })),
    );
    return { eventId: payload.eventId, enqueued: subscribed.length };
  },
});

export const webhookDeliverJob = defineJob({
  name: "webhook.deliver",
  schema: WebhookDeliveryPayload,
  opts: {
    attempts: 5,
    backoff: { type: "exponential", delay: 5000 },
    removeOnComplete: { age: 60 * 60 * 24 },
    removeOnFail: { age: 60 * 60 * 24 * 7 },
  },
  async handler(payload, { log, job }) {
    const webhookId = payload.webhookId;
    const orgId = payload.organizationId;
    if (!hasPrefix(webhookId, ID_PREFIX.webhook) || !hasPrefix(orgId, ID_PREFIX.organization)) {
      // Unbranded IDs match no row: the same "deleted" exit the lookup below
      // takes when the target is gone.
      return { skipped: true as const, reason: "deleted" };
    }
    const [target] = await db
      .select()
      .from(webhook)
      .where(and(eq(webhook.id, webhookId), eq(webhook.organizationId, orgId)));
    // Deleted or paused mid-flight. Drop silently, nothing to record against.
    if (!target || target.status !== "active") {
      return { skipped: true as const, reason: target ? "paused" : "deleted" };
    }

    const secret = await decryptSecret(target.encryptedSecret);
    const rawBody = JSON.stringify(payload.body);
    // In this BullMQ version `attemptsMade` counts FAILED prior attempts (0
    // during the first run), so the 1-based attempt number is +1. The same
    // convention the worker wrapper's log line uses (workers.ts).
    const attempt = (job.attemptsMade ?? 0) + 1;

    const started = performance.now();
    const denylist = await controlPlaneEgressDenylist();
    const { statusCode, error } = await deliverWebhookHttp({
      url: target.url,
      body: rawBody,
      headers: await webhookRequestHeaders({
        secret,
        body: rawBody,
        event: payload.event,
        deliveryId: job.id ?? crypto.randomUUID(),
        timestamp: Math.floor(Temporal.Now.instant().epochMilliseconds / 1000),
      }),
      denyHosts: denylist.blockedHosts,
      denyAddresses: denylist.blockedAddresses,
      allowAddresses: await egressAllowlist(),
    });
    const latencyMs = Math.round(performance.now() - started);

    await db.insert(webhookDelivery).values({
      organizationId: orgId,
      webhookId: target.id,
      event: payload.event,
      payload: payload.body,
      statusCode,
      ok: error === null,
      attempt,
      latencyMs,
      error,
    });

    if (error !== null) {
      log.warn({
        webhook: { webhookId: target.id, event: payload.event, attempt, statusCode, error },
      });
      // Throw so BullMQ retries (up to `attempts`); the row above already
      // recorded this attempt.
      throw deliveryFailure(statusCode, error);
    }

    return { webhookId: target.id, event: payload.event, statusCode, attempt, latencyMs };
  },
});
