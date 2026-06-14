/**
 * Notification channels router — channel CRUD + the event/channel subscription
 * matrix. Mutations are RBAC-gated on the `notificationChannel` resource.
 * Secrets are AES-GCM encrypted at rest (shared crypto in @otterdeploy/jobs);
 * `test` and real platform events both fan out through `triggerPlatformEvent`.
 */
import { triggerPlatformEvent } from "@otterdeploy/jobs";
import { encryptSecret } from "@otterdeploy/jobs/delivery/secret-crypto";

import type * as z from "zod";

import { orgScopedProcedure, requirePermission } from "../..";

import { subscriptionSchema } from "./contract";
import {
  type ChannelView,
  addSubscription,
  deleteChannel,
  getChannelRow,
  insertChannel,
  listChannelRows,
  listSubscriptionRows,
  removeSubscription,
  statsByChannel,
  toChannelView,
  updateChannel,
} from "./queries";

type ChannelKind = ChannelView["kind"];

const DEFAULT_TRANSPORT: Record<ChannelKind, string> = {
  slack: "incoming-webhook",
  discord: "webhook",
  email: "SMTP via Resend",
  webhook: "POST · HMAC-SHA256",
  telegram: "bot · long-poll",
  pagerduty: "Events API v2",
  push: "FCM",
};

export const notificationsRouter = {
  channels: {
    list: orgScopedProcedure.notifications.channels.list.handler(
      async ({ context }) => {
        const [rows, stats] = await Promise.all([
          listChannelRows(context.activeOrganizationId),
          statsByChannel(context.activeOrganizationId),
        ]);
        return rows.map((r) => toChannelView(r, stats.get(r.id)));
      },
    ),

    create: requirePermission({
      notificationChannel: ["create"],
    }).notifications.channels.create.handler(async ({ input, context }) => {
      const encryptedSecret = input.secret
        ? await encryptSecret(input.secret)
        : null;
      const row = await insertChannel({
        organizationId: context.activeOrganizationId,
        kind: input.kind,
        name: input.name,
        target: input.target,
        transport: input.transport || DEFAULT_TRANSPORT[input.kind],
        config: input.config,
        encryptedSecret,
      });
      context.log.set({ target: { type: "notificationChannel", id: row.id } });
      return toChannelView(row, undefined);
    }),

    update: requirePermission({
      notificationChannel: ["update"],
    }).notifications.channels.update.handler(
      async ({ input, context, errors }) => {
        context.log.set({ target: { type: "notificationChannel", id: input.id } });
        // Omit secret → leave stored value; provide secret → re-encrypt.
        const encryptedSecret =
          input.secret === undefined
            ? undefined
            : input.secret === ""
              ? null
              : await encryptSecret(input.secret);
        const row = await updateChannel(
          { organizationId: context.activeOrganizationId, id: input.id },
          {
            name: input.name,
            target: input.target,
            transport: input.transport,
            config: input.config,
            ...(encryptedSecret !== undefined ? { encryptedSecret } : {}),
          },
        );
        if (!row) throw errors.NOT_FOUND();
        const stats = await statsByChannel(context.activeOrganizationId);
        return toChannelView(row, stats.get(row.id));
      },
    ),

    delete: requirePermission({
      notificationChannel: ["delete"],
    }).notifications.channels.delete.handler(
      async ({ input, context, errors }) => {
        context.log.set({ target: { type: "notificationChannel", id: input.id } });
        const ok = await deleteChannel({
          organizationId: context.activeOrganizationId,
          id: input.id,
        });
        if (!ok) throw errors.NOT_FOUND();
        return { id: input.id };
      },
    ),

    pause: requirePermission({
      notificationChannel: ["update"],
    }).notifications.channels.pause.handler(
      async ({ input, context, errors }) => {
        context.log.set({ target: { type: "notificationChannel", id: input.id } });
        const current = await getChannelRow({
          organizationId: context.activeOrganizationId,
          id: input.id,
        });
        if (!current) throw errors.NOT_FOUND();
        // Resume from paused/disconnected, otherwise pause.
        const status = current.status === "active" ? "paused" : "active";
        const row = await updateChannel(
          { organizationId: context.activeOrganizationId, id: input.id },
          { status },
        );
        if (!row) throw errors.NOT_FOUND();
        const stats = await statsByChannel(context.activeOrganizationId);
        return toChannelView(row, stats.get(row.id));
      },
    ),

    test: requirePermission({
      notificationChannel: ["test"],
    }).notifications.channels.test.handler(
      async ({ input, context, errors }) => {
        const channel = await getChannelRow({
          organizationId: context.activeOrganizationId,
          id: input.id,
        });
        if (!channel) throw errors.NOT_FOUND();
        context.log.set({ target: { type: "notificationChannel", id: input.id } });
        await triggerPlatformEvent({
          organizationId: context.activeOrganizationId,
          channelId: input.id,
          eventId: "test.ping",
          severity: "info",
          title: "Test notification",
          message: `This is a test event from otterdeploy for "${channel.name}".`,
        });
        return { message: `Test event queued to ${channel.name}` };
      },
    ),
  },

  subscriptions: {
    list: orgScopedProcedure.notifications.subscriptions.list.handler(
      async ({ context }) => {
        const rows = await listSubscriptionRows(context.activeOrganizationId);
        // DB stores eventId as text; the contract narrows it to the catalog
        // enum, and only catalog ids are ever written, so the cast is safe.
        return rows as Array<z.infer<typeof subscriptionSchema>>;
      },
    ),

    toggle: requirePermission({
      notificationChannel: ["update"],
    }).notifications.subscriptions.toggle.handler(
      async ({ input, context, errors }) => {
        // Scope check: the channel must belong to the caller's org.
        const channel = await getChannelRow({
          organizationId: context.activeOrganizationId,
          id: input.channelId,
        });
        if (!channel) throw errors.NOT_FOUND();
        if (input.enabled) {
          await addSubscription({
            organizationId: context.activeOrganizationId,
            channelId: input.channelId,
            eventId: input.eventId,
          });
        } else {
          await removeSubscription({
            organizationId: context.activeOrganizationId,
            channelId: input.channelId,
            eventId: input.eventId,
          });
        }
        return input;
      },
    ),
  },
};
