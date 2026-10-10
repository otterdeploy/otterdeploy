/**
 * Timestamped webhook signatures, one scheme for both directions.
 *
 * Shaped after the Standard Webhooks spec: three headers,
 *
 *   webhook-id:        unique per message (stable across retries of it)
 *   webhook-timestamp: unix seconds when this attempt was signed
 *   webhook-signature: v1,<base64 HMAC-SHA256 of "<id>.<timestamp>.<body>">
 *
 * Signing the id and timestamp with the body is what makes a captured request
 * worthless later: the receiver refuses a timestamp outside its tolerance
 * window and remembers the ids it has accepted inside it. The older
 * `X-Otterdeploy-Signature: sha256=<hmac of body>` signed the body alone, so a
 * captured request verified forever.
 *
 * The HMAC key is the secret exactly as the panel shows it (its UTF-8 bytes),
 * the same key the older scheme used. With a Standard Webhooks library, pass
 * those bytes as a raw key rather than letting it base64-decode the secret.
 * `webhook-signature` may carry several space-separated signatures (key
 * rotation); any one valid `v1` signature verifies.
 */
import { timingSafeEqual } from "./crypto";

export const WEBHOOK_ID_HEADER = "webhook-id";
export const WEBHOOK_TIMESTAMP_HEADER = "webhook-timestamp";
export const WEBHOOK_SIGNATURE_HEADER = "webhook-signature";

/** How far a signed timestamp may be from the receiver's clock, either way. */
export const WEBHOOK_TOLERANCE_SECONDS = 5 * 60;

const SIGNATURE_VERSION = "v1";

export interface WebhookMessage {
  id: string;
  /** Unix seconds. */
  timestamp: number;
  body: string | ArrayBuffer;
}

function signedContent(message: WebhookMessage): Uint8Array<ArrayBuffer> {
  const prefix = new TextEncoder().encode(`${message.id}.${message.timestamp}.`);
  const body =
    typeof message.body === "string"
      ? new TextEncoder().encode(message.body)
      : new Uint8Array(message.body);
  const out = new Uint8Array(prefix.byteLength + body.byteLength);
  out.set(prefix, 0);
  out.set(body, prefix.byteLength);
  return out;
}

async function hmacBase64(secret: string, data: Uint8Array<ArrayBuffer>): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    Uint8Array.from(new TextEncoder().encode(secret)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, data));
  let binary = "";
  for (const byte of mac) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** The `webhook-signature` value for one message. */
export async function signWebhook(secret: string, message: WebhookMessage): Promise<string> {
  return `${SIGNATURE_VERSION},${await hmacBase64(secret, signedContent(message))}`;
}

/** All three headers for one delivery attempt. */
export async function webhookSignatureHeaders(
  secret: string,
  message: WebhookMessage,
): Promise<Record<string, string>> {
  return {
    [WEBHOOK_ID_HEADER]: message.id,
    [WEBHOOK_TIMESTAMP_HEADER]: String(message.timestamp),
    [WEBHOOK_SIGNATURE_HEADER]: await signWebhook(secret, message),
  };
}

export type WebhookSignatureFailure =
  | "missing-headers"
  | "invalid-timestamp"
  | "timestamp-too-old"
  | "timestamp-too-new"
  | "invalid-signature";

export type WebhookVerification =
  | { ok: true; id: string; timestamp: number }
  | { ok: false; reason: WebhookSignatureFailure; message: string };

const FAILURE_MESSAGES: Record<WebhookSignatureFailure, string> = {
  "missing-headers": "missing webhook-id, webhook-timestamp or webhook-signature header",
  "invalid-timestamp": "webhook-timestamp is not a unix timestamp in seconds",
  "timestamp-too-old": "webhook-timestamp is too old",
  "timestamp-too-new": "webhook-timestamp is too far in the future",
  "invalid-signature": "invalid signature",
};

function failure(reason: WebhookSignatureFailure): WebhookVerification {
  return { ok: false, reason, message: FAILURE_MESSAGES[reason] };
}

export interface VerifyWebhookInput {
  id: string | null | undefined;
  timestamp: string | null | undefined;
  signature: string | null | undefined;
  body: string | ArrayBuffer;
  /** The receiver's clock, unix seconds. */
  nowSeconds: number;
  toleranceSeconds?: number;
}

/**
 * Verify one received message: headers present, timestamp inside the
 * tolerance window, and at least one `v1` signature matching. Replay of an id
 * inside the window is the caller's to refuse (it owns the seen-id store).
 */
export async function verifyWebhook(
  secret: string,
  input: VerifyWebhookInput,
): Promise<WebhookVerification> {
  const { id, timestamp: rawTimestamp, signature } = input;
  if (!id || !rawTimestamp || !signature) return failure("missing-headers");
  if (!/^\d{1,12}$/.test(rawTimestamp)) return failure("invalid-timestamp");
  const timestamp = Number(rawTimestamp);
  const tolerance = input.toleranceSeconds ?? WEBHOOK_TOLERANCE_SECONDS;
  if (timestamp < input.nowSeconds - tolerance) return failure("timestamp-too-old");
  if (timestamp > input.nowSeconds + tolerance) return failure("timestamp-too-new");

  const expected = await signWebhook(secret, { id, timestamp, body: input.body });
  const matches = signature
    .split(" ")
    .filter((candidate) => candidate.startsWith(`${SIGNATURE_VERSION},`))
    .some((candidate) => timingSafeEqual(candidate, expected));
  return matches ? { ok: true, id, timestamp } : failure("invalid-signature");
}
