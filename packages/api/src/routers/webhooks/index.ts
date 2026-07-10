import { ORPCError } from "@orpc/server";
/**
 * Webhooks router — outbound webhook CRUD + delivery log + inbound trigger
 * endpoints. Mutations are RBAC-gated on the `notificationChannel` resource
 * (webhooks are the machine half of the same event fan-out surface; a
 * dedicated `webhook` RBAC resource can split them later without touching
 * handlers). Secrets are AES-GCM encrypted at rest (shared crypto in
 * @otterdeploy/jobs) and minted server-side: outbound signing keys are
 * revealable via `reveal`; inbound secrets are returned exactly once from
 * `create` (then only via `reveal`, same update-permission gate).
 *
 * Real platform events reach webhooks via the fan-out hook inside
 * `triggerPlatformEvent` (packages/jobs/src/triggers.ts); `test` enqueues a
 * single signed `test.ping` through the same delivery job.
 */
import { triggerWebhookDelivery } from "@otterdeploy/jobs";
import { decryptSecret, encryptSecret } from "@otterdeploy/jobs/delivery/secret-crypto";

import { orgScopedProcedure, requirePermission } from "../..";
import {
  deleteInboundEndpoint,
  deleteWebhook,
  getInboundRow,
  getInboundView,
  getWebhookRow,
  hostOf,
  insertInboundEndpoint,
  insertWebhook,
  listInboundViews,
  listRecentDeliveries,
  listServiceOptions,
  listWebhookRows,
  serviceBelongsToOrg,
  statsByWebhook,
  toWebhookView,
  updateInboundEndpoint,
  updateWebhook,
} from "./queries";
import { mintInboundSecret, mintInboundToken, mintWebhookSecret } from "./signature";

export const webhooksRouter = {
  outbound: {
    list: orgScopedProcedure.webhooks.outbound.list.handler(async ({ context }) => {
      const [rows, stats] = await Promise.all([
        listWebhookRows(context.activeOrganizationId),
        statsByWebhook(context.activeOrganizationId),
      ]);
      return rows.map((r) => toWebhookView(r, stats.get(r.id)));
    }),

    create: requirePermission({
      notificationChannel: ["create"],
    }).webhooks.outbound.create.handler(async ({ input, context }) => {
      const encryptedSecret = await encryptSecret(mintWebhookSecret());
      const row = await insertWebhook({
        organizationId: context.activeOrganizationId,
        url: input.url,
        events: input.events,
        encryptedSecret,
      });
      context.log.set({ target: { type: "webhook", id: row.id } });
      return toWebhookView(row, undefined);
    }),

    update: requirePermission({
      notificationChannel: ["update"],
    }).webhooks.outbound.update.handler(async ({ input, context, errors }) => {
      context.log.set({ target: { type: "webhook", id: input.id } });
      const row = await updateWebhook(
        { organizationId: context.activeOrganizationId, id: input.id },
        {
          ...(input.url !== undefined ? { url: input.url } : {}),
          ...(input.events !== undefined ? { events: input.events } : {}),
        },
      );
      if (!row) throw errors.NOT_FOUND();
      const stats = await statsByWebhook(context.activeOrganizationId);
      return toWebhookView(row, stats.get(row.id));
    }),

    delete: requirePermission({
      notificationChannel: ["delete"],
    }).webhooks.outbound.delete.handler(async ({ input, context, errors }) => {
      context.log.set({ target: { type: "webhook", id: input.id } });
      const ok = await deleteWebhook({
        organizationId: context.activeOrganizationId,
        id: input.id,
      });
      if (!ok) throw errors.NOT_FOUND();
      return { id: input.id };
    }),

    pause: requirePermission({
      notificationChannel: ["update"],
    }).webhooks.outbound.pause.handler(async ({ input, context, errors }) => {
      context.log.set({ target: { type: "webhook", id: input.id } });
      const current = await getWebhookRow({
        organizationId: context.activeOrganizationId,
        id: input.id,
      });
      if (!current) throw errors.NOT_FOUND();
      const status = current.status === "active" ? ("paused" as const) : ("active" as const);
      const row = await updateWebhook(
        { organizationId: context.activeOrganizationId, id: input.id },
        { status },
      );
      if (!row) throw errors.NOT_FOUND();
      const stats = await statsByWebhook(context.activeOrganizationId);
      return toWebhookView(row, stats.get(row.id));
    }),

    test: requirePermission({
      notificationChannel: ["test"],
    }).webhooks.outbound.test.handler(async ({ input, context, errors }) => {
      const row = await getWebhookRow({
        organizationId: context.activeOrganizationId,
        id: input.id,
      });
      if (!row) throw errors.NOT_FOUND();
      context.log.set({ target: { type: "webhook", id: input.id } });
      await triggerWebhookDelivery({
        organizationId: context.activeOrganizationId,
        webhookId: input.id,
        event: "test.ping",
        body: {
          event: "test.ping",
          severity: "info",
          title: "Test webhook",
          message: "This is a signed test delivery from otterdeploy.",
          data: {},
          timestamp: new Date().toISOString(),
        },
      });
      return { message: `Test delivery queued to ${hostOf(row.url)}` };
    }),

    reveal: requirePermission({
      notificationChannel: ["update"],
    }).webhooks.outbound.reveal.handler(async ({ input, context, errors }) => {
      const row = await getWebhookRow({
        organizationId: context.activeOrganizationId,
        id: input.id,
      });
      if (!row) throw errors.NOT_FOUND();
      context.log.set({ target: { type: "webhook", id: input.id } });
      return { secret: await decryptSecret(row.encryptedSecret) };
    }),
  },

  deliveries: {
    list: orgScopedProcedure.webhooks.deliveries.list.handler(async ({ input, context }) => {
      return listRecentDeliveries(context.activeOrganizationId, input?.limit ?? 50);
    }),
  },

  inbound: {
    list: orgScopedProcedure.webhooks.inbound.list.handler(async ({ context }) => {
      return listInboundViews(context.activeOrganizationId);
    }),

    create: requirePermission({
      notificationChannel: ["create"],
    }).webhooks.inbound.create.handler(async ({ input, context }) => {
      if (input.action === "redeploy") {
        if (!input.resourceId) {
          throw new ORPCError("BAD_REQUEST", {
            message: "A redeploy endpoint needs a target service.",
          });
        }
        const owned = await serviceBelongsToOrg({
          organizationId: context.activeOrganizationId,
          resourceId: input.resourceId,
        });
        if (!owned) {
          throw new ORPCError("BAD_REQUEST", { message: "Unknown service." });
        }
      }
      const secret = mintInboundSecret();
      const row = await insertInboundEndpoint({
        organizationId: context.activeOrganizationId,
        name: input.name,
        token: mintInboundToken(),
        encryptedSecret: await encryptSecret(secret),
        action: input.action,
        resourceId: input.action === "redeploy" ? (input.resourceId ?? null) : null,
        ipAllowlist: input.ipAllowlist,
      });
      context.log.set({ target: { type: "inboundEndpoint", id: row.id } });
      const endpoint = await getInboundView({
        organizationId: context.activeOrganizationId,
        id: row.id,
      });
      if (!endpoint) throw new Error("inbound endpoint vanished after insert");
      // The plaintext secret exists in this response and nowhere else.
      return { endpoint, secret };
    }),

    update: requirePermission({
      notificationChannel: ["update"],
    }).webhooks.inbound.update.handler(async ({ input, context, errors }) => {
      context.log.set({ target: { type: "inboundEndpoint", id: input.id } });
      if (input.resourceId) {
        const owned = await serviceBelongsToOrg({
          organizationId: context.activeOrganizationId,
          resourceId: input.resourceId,
        });
        if (!owned) throw new ORPCError("BAD_REQUEST", { message: "Unknown service." });
      }
      const row = await updateInboundEndpoint(
        { organizationId: context.activeOrganizationId, id: input.id },
        {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.action !== undefined ? { action: input.action } : {}),
          ...(input.resourceId !== undefined ? { resourceId: input.resourceId } : {}),
          ...(input.ipAllowlist !== undefined ? { ipAllowlist: input.ipAllowlist } : {}),
        },
      );
      if (!row) throw errors.NOT_FOUND();
      const view = await getInboundView({
        organizationId: context.activeOrganizationId,
        id: row.id,
      });
      if (!view) throw errors.NOT_FOUND();
      return view;
    }),

    delete: requirePermission({
      notificationChannel: ["delete"],
    }).webhooks.inbound.delete.handler(async ({ input, context, errors }) => {
      context.log.set({ target: { type: "inboundEndpoint", id: input.id } });
      const ok = await deleteInboundEndpoint({
        organizationId: context.activeOrganizationId,
        id: input.id,
      });
      if (!ok) throw errors.NOT_FOUND();
      return { id: input.id };
    }),

    pause: requirePermission({
      notificationChannel: ["update"],
    }).webhooks.inbound.pause.handler(async ({ input, context, errors }) => {
      context.log.set({ target: { type: "inboundEndpoint", id: input.id } });
      const current = await getInboundRow({
        organizationId: context.activeOrganizationId,
        id: input.id,
      });
      if (!current) throw errors.NOT_FOUND();
      const status = current.status === "active" ? ("paused" as const) : ("active" as const);
      const row = await updateInboundEndpoint(
        { organizationId: context.activeOrganizationId, id: input.id },
        { status },
      );
      if (!row) throw errors.NOT_FOUND();
      const view = await getInboundView({
        organizationId: context.activeOrganizationId,
        id: row.id,
      });
      if (!view) throw errors.NOT_FOUND();
      return view;
    }),

    reveal: requirePermission({
      notificationChannel: ["update"],
    }).webhooks.inbound.reveal.handler(async ({ input, context, errors }) => {
      const row = await getInboundRow({
        organizationId: context.activeOrganizationId,
        id: input.id,
      });
      if (!row) throw errors.NOT_FOUND();
      context.log.set({ target: { type: "inboundEndpoint", id: input.id } });
      return { secret: await decryptSecret(row.encryptedSecret) };
    }),

    serviceOptions: orgScopedProcedure.webhooks.inbound.serviceOptions.handler(
      async ({ context }) => {
        return listServiceOptions(context.activeOrganizationId);
      },
    ),
  },
};
