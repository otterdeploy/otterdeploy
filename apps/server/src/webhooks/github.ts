/**
 * GitHub App webhook endpoint.
 *
 * - Reads the raw body (signature verification needs the exact bytes).
 * - Verifies `X-Hub-Signature-256` HMAC-SHA256 against
 *   `GITHUB_APP_WEBHOOK_SECRET` using a timing-safe compare.
 * - Dispatches the parsed event to the package-level handler in
 *   `@otterstack/api/git`.
 *
 * Always responds 2xx once the signature passes — GitHub retries on any
 * non-2xx and we don't want a transient handler error to repeatedly
 * re-create deployment rows. Handler failures are logged and surfaced in
 * the response body but the status stays 200.
 */

import { handleGithubWebhook } from "@otterstack/api/git";
import { env } from "@otterstack/env/server";
import { log, parseError } from "evlog";
import { type EvlogVariables } from "evlog/hono";
import type { Hono } from "hono";

const SIGNATURE_HEADER = "x-hub-signature-256";
const EVENT_HEADER = "x-github-event";
const DELIVERY_HEADER = "x-github-delivery";

export function registerGithubWebhookRoutes(app: Hono<EvlogVariables>): void {
  app.post("/api/webhooks/github", async (c) => {
    const secret = env.GITHUB_APP_WEBHOOK_SECRET;
    if (!secret) {
      log.warn({ github: { event: "webhook.unconfigured" } });
      return c.json(
        { ok: false, error: "GitHub App webhook secret not configured" },
        503,
      );
    }

    const signature = c.req.header(SIGNATURE_HEADER);
    const event = c.req.header(EVENT_HEADER);
    const deliveryId = c.req.header(DELIVERY_HEADER) ?? "unknown";

    if (!signature || !event) {
      return c.json({ ok: false, error: "missing signature or event header" }, 400);
    }

    const rawBody = await c.req.raw.arrayBuffer();
    const ok = await verifySignature(secret, signature, rawBody);
    if (!ok) {
      log.warn({
        github: { event: "webhook.bad_signature", deliveryId, eventType: event },
      });
      return c.json({ ok: false, error: "bad signature" }, 401);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(new TextDecoder().decode(rawBody));
    } catch {
      return c.json({ ok: false, error: "invalid JSON" }, 400);
    }

    try {
      const result = await handleGithubWebhook({
        event,
        payload: parsed,
        deliveryId,
      });
      log.info({
        github: {
          event: `webhook.${event}`,
          deliveryId,
          result,
        },
      });
      return c.json({ ok: true, result });
    } catch (error) {
      const parsedErr = parseError(error);
      log.error({
        github: {
          event: `webhook.${event}.failed`,
          deliveryId,
          error: parsedErr.message,
        },
      });
      // 200 on purpose — see file header.
      return c.json({ ok: false, error: parsedErr.message });
    }
  });
}

async function verifySignature(
  secret: string,
  signatureHeader: string,
  body: ArrayBuffer,
): Promise<boolean> {
  // Header shape: "sha256=<hex>".
  if (!signatureHeader.startsWith("sha256=")) return false;
  const expected = signatureHeader.slice("sha256=".length);

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const macBuf = await crypto.subtle.sign("HMAC", key, body);
  const actual = hex(new Uint8Array(macBuf));

  return timingSafeEqualHex(expected, actual);
}

function hex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}
