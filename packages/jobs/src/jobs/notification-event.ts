import { db } from "@otterdeploy/db";
import {
  notificationChannel,
  notificationDelivery,
  notificationSubscription,
} from "@otterdeploy/db/schema";
/**
 * Platform-event fan-out. A single deploy/build/backup/etc. outcome enqueues
 * one of these; the handler resolves every channel subscribed to that event in
 * the org and delivers to each, writing an append-only `notification_delivery`
 * row per attempt (those rows power the per-channel stats on the UI card).
 *
 * Two modes:
 *   - fan-out (default): deliver to all `active` channels subscribed to
 *     (organizationId, eventId) via the subscription matrix.
 *   - test (`channelId` set): deliver to that one channel regardless of its
 *     subscriptions — the "Test" / "Send test" button. Still logged.
 */
import { and, eq } from "drizzle-orm";
import * as z from "zod";

import { defineJob } from "../define";
import { type ChannelKind, type ResolvedChannel, deliverToChannel } from "../delivery/channels";
import { decryptSecret } from "../delivery/secret-crypto";
import { shouldFanOutInApp, writeInboxRows } from "./notification-inbox";

export const PlatformEventPayload = z.object({
  organizationId: z.string().min(1),
  eventId: z.string().min(1),
  severity: z.enum(["info", "ok", "warn", "err"]).default("info"),
  title: z.string().min(1),
  message: z.string().default(""),
  data: z.record(z.string(), z.string()).optional(),
  // Test mode: target exactly one channel, bypassing the subscription matrix.
  channelId: z.string().optional(),
});
export type PlatformEventPayload = z.infer<typeof PlatformEventPayload>;

type ChannelRow = typeof notificationChannel.$inferSelect;
// The job payload carries IDs as plain strings (BullMQ JSON); the schema's
// columns are branded. Re-brand at the column boundary via the inferred types.
type OrgId = ChannelRow["organizationId"];
type ChannelId = ChannelRow["id"];

async function resolveChannels(payload: PlatformEventPayload): Promise<ChannelRow[]> {
  const orgId = payload.organizationId as OrgId;
  if (payload.channelId) {
    return db
      .select()
      .from(notificationChannel)
      .where(
        and(
          eq(notificationChannel.id, payload.channelId as ChannelId),
          eq(notificationChannel.organizationId, orgId),
        ),
      );
  }
  const rows = await db
    .select({ channel: notificationChannel })
    .from(notificationSubscription)
    .innerJoin(notificationChannel, eq(notificationChannel.id, notificationSubscription.channelId))
    .where(
      and(
        eq(notificationSubscription.organizationId, orgId),
        eq(notificationSubscription.eventId, payload.eventId),
        eq(notificationChannel.status, "active"),
      ),
    );
  return rows.map((r) => r.channel);
}

async function toResolved(row: ChannelRow): Promise<ResolvedChannel> {
  return {
    id: row.id,
    kind: row.kind as ChannelKind,
    name: row.name,
    target: row.target,
    config: row.config ?? {},
    secret: row.encryptedSecret ? await decryptSecret(row.encryptedSecret) : null,
  };
}

export const notificationEventJob = defineJob({
  name: "notification.event",
  schema: PlatformEventPayload,
  opts: {
    attempts: 3,
    backoff: { type: "exponential", delay: 1000 },
    removeOnComplete: { age: 60 * 60 * 24 },
    removeOnFail: { age: 60 * 60 * 24 * 7 },
  },
  async handler(payload, { log, job }) {
    const channels = await resolveChannels(payload);
    log.info({
      notification: {
        step: "event",
        eventId: payload.eventId,
        test: Boolean(payload.channelId),
        channels: channels.length,
      },
    });

    // In-app inbox fan-out (the header bell) — same subscription gate as the
    // channels, one row per org member. Runs BEFORE channel delivery and is
    // deduped on the job id, so a retried job never double-writes the inbox.
    if (
      shouldFanOutInApp({
        eventId: payload.eventId,
        testChannelId: payload.channelId,
        subscribedChannelCount: channels.length,
      })
    ) {
      // The BullMQ job id is stable across retries — the dedupe key. The
      // fallback (id-less jobs shouldn't happen for queued work) is unique
      // per call so it can never suppress a later, different occurrence.
      const occurrence = job.id ? `job:${job.id}` : `evt:${payload.eventId}:${Date.now()}`;
      const inboxRows = await writeInboxRows(payload, occurrence);
      log.info({ notification: { step: "inbox", eventId: payload.eventId, rows: inboxRows } });
    }

    let delivered = 0;
    for (const row of channels) {
      const resolved = await toResolved(row);
      const result = await deliverToChannel(resolved, {
        eventId: payload.eventId,
        severity: payload.severity,
        title: payload.title,
        message: payload.message,
        data: payload.data,
      });
      if (result.ok) delivered++;
      else
        log.warn({
          notification: {
            channelId: row.id,
            kind: row.kind,
            error: result.error,
          },
        });

      await db.insert(notificationDelivery).values({
        organizationId: payload.organizationId as OrgId,
        channelId: row.id,
        eventId: payload.eventId,
        status: result.ok ? "delivered" : "failed",
        error: result.ok ? null : (result.error ?? "unknown error"),
      });
    }

    return {
      eventId: payload.eventId,
      attempted: channels.length,
      delivered,
    };
  },
});
