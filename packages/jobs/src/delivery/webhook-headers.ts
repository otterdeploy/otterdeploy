/**
 * Headers for a webhook notification channel's POST. Kept apart
 * from ./channels.ts (which reads the validated env at import) so it is
 * testable on its own.
 *
 * With a secret: the timestamped `webhook-id` / `webhook-timestamp` /
 * `webhook-signature` over id.timestamp.body, which lets a receiver refuse a
 * replay, plus the older body-only `x-otterdeploy-signature` for receivers
 * that already verify it. Without one: no signature at all.
 */
import { hmacSha256Hex } from "@otterdeploy/shared/crypto";
import { Temporal } from "@otterdeploy/shared/temporal";
import { webhookSignatureHeaders } from "@otterdeploy/shared/webhook-signature";

export async function webhookChannelHeaders(
  secret: string | null,
  body: string,
  message: { id: string; timestamp: number } = {
    id: crypto.randomUUID(),
    timestamp: Math.floor(Temporal.Now.instant().epochMilliseconds / 1000),
  },
): Promise<Record<string, string>> {
  if (!secret) return { "content-type": "application/json" };
  return {
    "content-type": "application/json",
    ...(await webhookSignatureHeaders(secret, { ...message, body })),
    "x-otterdeploy-signature": `sha256=${await hmacSha256Hex(secret, body)}`,
  };
}
