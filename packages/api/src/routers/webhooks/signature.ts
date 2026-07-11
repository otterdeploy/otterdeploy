/**
 * Webhook HMAC signing + credential minting.
 *
 * One signature scheme for both directions: `sha256=<hex hmac of the raw
 * body>` in the `X-Otterdeploy-Signature` header. Outbound deliveries are
 * signed by the delivery job (packages/jobs/src/jobs/webhook.ts) with the
 * same shared `hmacSha256Hex`, so `verifySignatureHeader` here is the exact
 * inverse — covered by __tests__/signature.test.ts.
 */
import { bytesToHex, hmacSha256Hex, timingSafeEqual } from "@otterdeploy/shared/crypto";

export const SIGNATURE_HEADER = "x-otterdeploy-signature";
const SIGNATURE_PREFIX = "sha256=";

/** Produce the signature header value for a raw body. */
export async function signPayload(secret: string, rawBody: string | ArrayBuffer): Promise<string> {
  return `${SIGNATURE_PREFIX}${await hmacSha256Hex(secret, rawBody)}`;
}

/**
 * Verify a client-supplied `X-Otterdeploy-Signature` header against the raw
 * request bytes. Timing-safe compare; tolerant of hex case, strict about the
 * `sha256=` scheme prefix.
 */
export async function verifySignatureHeader(
  secret: string,
  header: string | null | undefined,
  rawBody: string | ArrayBuffer,
): Promise<boolean> {
  if (!header || !header.startsWith(SIGNATURE_PREFIX)) return false;
  const claimed = header.slice(SIGNATURE_PREFIX.length).toLowerCase();
  const expected = await hmacSha256Hex(secret, rawBody);
  return timingSafeEqual(claimed, expected);
}

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

/** Inbound URL slug (`/api/webhooks/in/<token>`): 160 bits, hex — enough that
 * the URL is unguessable, though the HMAC remains the real gate. */
export function mintInboundToken(): string {
  return randomHex(20);
}
