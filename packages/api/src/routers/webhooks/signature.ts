/**
 * Webhook credential minting, and the name of the older signature header.
 *
 * Signing and verifying live in @otterdeploy/shared/webhook-signature: one
 * timestamped scheme for both directions. `webhook-id`,
 * `webhook-timestamp` and `webhook-signature: v1,<base64 HMAC-SHA256 of
 * "<id>.<timestamp>.<body>">`, keyed by the secret as shown.
 *
 * `X-Otterdeploy-Signature: sha256=<hex HMAC of the body>` is the older,
 * body-only scheme. Outbound deliveries still send it alongside the new
 * headers, for receivers that already verify it; it cannot tell a replay from
 * a delivery, so receivers should move to `webhook-signature`. Inbound calls
 * carrying only this header are refused.
 */
import { bytesToHex } from "@otterdeploy/shared/crypto";

export const SIGNATURE_HEADER = "x-otterdeploy-signature";

function randomHex(bytes: number): string {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(bytes)));
}

/** Outbound signing key: `whsec_` + 256 bits of entropy. */
export function mintWebhookSecret(): string {
  return `whsec_${randomHex(32)}`;
}

/** Inbound endpoint HMAC secret: `inhsec_` + 256 bits. Shown exactly once. */
export function mintInboundSecret(): string {
  return `inhsec_${randomHex(32)}`;
}

/** Inbound URL slug (`/api/webhooks/in/<token>`): 160 bits, hex: enough that
 * the URL is unguessable, though the HMAC remains the real gate. */
export function mintInboundToken(): string {
  return randomHex(20);
}
