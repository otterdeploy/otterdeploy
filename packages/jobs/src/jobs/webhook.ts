import { db } from "@otterdeploy/db";
import { webhook, webhookDelivery } from "@otterdeploy/db/schema";
/**
 * Outbound webhook pipeline — two jobs:
 *
 *   webhook.event   — fan-out. One per platform event (enqueued from
 *     `triggerPlatformEvent` alongside the notification fan-out). Resolves
 *     every ACTIVE webhook in the org whose `events` array contains the
 *     event id and enqueues one `webhook.deliver` per match, so each target
 *     gets its own retry cycle and one dead endpoint can't stall the rest.
 *
 *   webhook.deliver — a single POST to a single webhook. Signs the raw JSON
 *     body with the webhook's (decrypted) secret — `X-Otterdeploy-Signature:
 *     sha256=<hmac-hex>` — 10s timeout, and writes ONE `webhook_delivery` row
 *     PER ATTEMPT (status code, ok, attempt #, latency, error). On failure it
 *     throws so BullMQ retries with exponential backoff (5 attempts); every
 *     attempt is already recorded by the time the throw happens.
 */
import { hmacSha256Hex } from "@otterdeploy/shared/crypto";
import { and, arrayContains, eq } from "drizzle-orm";
import * as z from "zod";

import { defineJob } from "../define";
import { decryptSecret } from "../delivery/secret-crypto";

export const SIGNATURE_HEADER = "X-Otterdeploy-Signature";
const DELIVERY_TIMEOUT_MS = 10_000;

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
  /** The exact JSON object that will be serialized, signed, and POSTed. */
  body: z.record(z.string(), z.unknown()),
});
export type WebhookDeliveryPayload = z.infer<typeof WebhookDeliveryPayload>;

type WebhookRow = typeof webhook.$inferSelect;
// Job payloads carry IDs as plain strings (BullMQ JSON); columns are branded.
type OrgId = WebhookRow["organizationId"];
type WhId = WebhookRow["id"];

/** The wire format receivers get. Kept flat and stable — it's an API. */
export function buildWebhookBody(payload: WebhookEventPayload): Record<string, unknown> {
  return {
    event: payload.eventId,
    severity: payload.severity,
    title: payload.title,
    message: payload.message,
    data: payload.data ?? {},
    timestamp: new Date().toISOString(),
  };
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
    const subscribed = await db
      .select({ id: webhook.id })
      .from(webhook)
      .where(
        and(
          eq(webhook.organizationId, payload.organizationId as OrgId),
          eq(webhook.status, "active"),
          arrayContains(webhook.events, [payload.eventId]),
        ),
      );

    log.info({
      webhook: { step: "fanout", eventId: payload.eventId, targets: subscribed.length },
    });
    if (subscribed.length === 0) return { eventId: payload.eventId, enqueued: 0 };

    const body = buildWebhookBody(payload);
    // Lazy import: `queues.ts` imports the registry, and this file is part of
    // the registry — a top-level import here is a module cycle that leaves the
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
    const [target] = await db
      .select()
      .from(webhook)
      .where(
        and(
          eq(webhook.id, payload.webhookId as WhId),
          eq(webhook.organizationId, payload.organizationId as OrgId),
        ),
      );
    // Deleted or paused mid-flight — drop silently, nothing to record against.
    if (!target || target.status !== "active") {
      return { skipped: true as const, reason: target ? "paused" : "deleted" };
    }

    const secret = await decryptSecret(target.encryptedSecret);
    const rawBody = JSON.stringify(payload.body);
    const signature = `sha256=${await hmacSha256Hex(secret, rawBody)}`;
    // In this BullMQ version `attemptsMade` counts FAILED prior attempts (0
    // during the first run), so the 1-based attempt number is +1 — the same
    // convention the worker wrapper's log line uses (workers.ts).
    const attempt = (job.attemptsMade ?? 0) + 1;

    const started = performance.now();
    let statusCode: number | null = null;
    let error: string | null = null;
    try {
      const res = await fetch(target.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "user-agent": "otterdeploy-webhooks/1",
          [SIGNATURE_HEADER]: signature,
          "X-Otterdeploy-Event": payload.event,
          "X-Otterdeploy-Delivery": String(job.id ?? ""),
        },
        body: rawBody,
        signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
      });
      statusCode = res.status;
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        error = `HTTP ${res.status}${text ? `: ${text.slice(0, 200)}` : ""}`;
      }
      // Drain/discard the body on success so the socket is released.
      else await res.arrayBuffer().catch(() => undefined);
    } catch (err) {
      error =
        err instanceof Error
          ? err.name === "TimeoutError"
            ? `timeout after ${DELIVERY_TIMEOUT_MS}ms`
            : err.message
          : String(err);
    }
    const latencyMs = Math.round(performance.now() - started);

    await db.insert(webhookDelivery).values({
      organizationId: payload.organizationId as OrgId,
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
      throw new Error(`webhook delivery failed: ${error}`);
    }

    return { webhookId: target.id, event: payload.event, statusCode, attempt, latencyMs };
  },
});
