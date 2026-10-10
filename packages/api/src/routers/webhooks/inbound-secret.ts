/**
 * An inbound endpoint's HMAC secret: reveal it, and rotate it.
 * Split out of ./index so that file stays under its line cap.
 *
 * Before this the only way to revoke a leaked secret was delete + recreate,
 * which also changed the endpoint URL every sender had configured. Rotation
 * keeps the URL (the token) and mints a new secret, returned in plaintext
 * exactly once like create. With `graceMinutes > 0` the replaced secret keeps
 * verifying until then (see ./inbound), so a sender can be switched over
 * without a window of rejected calls; with 0 it stops at once.
 */
import { decryptSecret, encryptSecret } from "@otterdeploy/jobs/delivery/secret-crypto";
import { Temporal } from "@otterdeploy/shared/temporal";

import { requirePermission } from "../..";
import { getInboundRow, getInboundView, rotateInboundEndpointSecret } from "./queries";
import { mintInboundSecret } from "./signature";

export const revealInboundSecretHandler = requirePermission({
  notificationChannel: ["update"],
}).webhooks.inbound.reveal.handler(async ({ input, context, errors }) => {
  const row = await getInboundRow({ organizationId: context.activeOrganizationId, id: input.id });
  if (!row) throw errors.NOT_FOUND();
  context.log.set({ target: { type: "inboundEndpoint", id: input.id } });
  return { secret: await decryptSecret(row.encryptedSecret) };
});

export const rotateInboundSecretHandler = requirePermission({
  notificationChannel: ["update"],
}).webhooks.inbound.rotateSecret.handler(async ({ input, context, errors }) => {
  context.log.set({
    target: { type: "inboundEndpoint", id: input.id },
    webhookInbound: { action: "rotateSecret", graceMinutes: input.graceMinutes },
  });
  const scope = { organizationId: context.activeOrganizationId, id: input.id };
  const secret = mintInboundSecret();
  const expires =
    input.graceMinutes > 0 ? Temporal.Now.instant().add({ minutes: input.graceMinutes }) : null;
  // One UPDATE, no read first: the SET reads the row's CURRENT secret into
  // the previous slot, so two concurrent rotations cannot both keep the same
  // old secret alive, and a foreign or missing id simply matches nothing.
  const rotated = await rotateInboundEndpointSecret(scope, {
    encryptedSecret: await encryptSecret(secret),
    // The timestamp column demands a Date (drizzle seam).
    previousSecretExpiresAt: expires ? new Date(expires.epochMilliseconds) : null,
  });
  const endpoint = rotated ? await getInboundView(scope) : null;
  if (!endpoint) throw errors.NOT_FOUND();
  // The plaintext secret exists in this response and nowhere else.
  return { endpoint, secret, previousSecretExpiresAt: expires ? expires.toString() : null };
});
