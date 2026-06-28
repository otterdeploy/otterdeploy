/**
 * GitHub App webhook handler.
 *
 * - Reads the raw body (signature verification needs the exact bytes).
 * - Routes the delivery to the right Git provider row using GitHub's
 *   `X-GitHub-Hook-Installation-Target-ID` header (the App ID). Different
 *   orgs can have different Apps; one shared webhook URL hosts them all.
 * - Verifies `X-Hub-Signature-256` HMAC-SHA256 against the App's
 *   per-provider webhook secret (decrypted on the fly), timing-safe compare.
 * - Dispatches the parsed event to the package-level handler in
 *   `@otterdeploy/api/git`.
 *
 * Always responds 2xx once the signature passes — GitHub retries on any
 * non-2xx and we don't want a transient handler error to repeatedly
 * re-create deployment rows. Handler failures are logged and surfaced in
 * the response body but the status stays 200.
 */

import type { Handler } from "hono";

import { handleGithubWebhook, loadGithubAppByExternalAppIdForWebhook } from "@otterdeploy/api/git";
import { bytesToHex, timingSafeEqual } from "@otterdeploy/shared/crypto";
import { Result } from "better-result";
import { log, parseError } from "evlog";

const SIGNATURE_HEADER = "x-hub-signature-256";
const EVENT_HEADER = "x-github-event";
const DELIVERY_HEADER = "x-github-delivery";
const TARGET_APP_HEADER = "x-github-hook-installation-target-id";

export const githubWebhookHandler: Handler = async (c) => {
  const signature = c.req.header(SIGNATURE_HEADER);
  const event = c.req.header(EVENT_HEADER);
  const deliveryId = c.req.header(DELIVERY_HEADER) ?? "unknown";
  const targetAppId = c.req.header(TARGET_APP_HEADER);

  if (!signature || !event || !targetAppId) {
    return c.json(
      {
        ok: false,
        error: "missing signature, event, or hook-target-id header",
      },
      400,
    );
  }

  // Look up which org's provider row owns this App. If no row matches,
  // the App is unknown to us (someone else's webhook hit our endpoint by
  // mistake, or the provider was deleted) — reply 404 so GitHub stops
  // retrying.
  const appConfig = await loadGithubAppByExternalAppIdForWebhook(targetAppId);
  if (!appConfig) {
    log.warn({
      github: {
        event: "webhook.unknown_app",
        deliveryId,
        targetAppId,
        eventType: event,
      },
    });
    return c.json({ ok: false, error: "unknown app" }, 404);
  }

  const rawBody = await c.req.raw.arrayBuffer();
  const ok = await verifySignature(appConfig.webhookSecret, signature, rawBody);
  if (!ok) {
    log.warn({
      github: {
        event: "webhook.bad_signature",
        deliveryId,
        targetAppId,
        providerId: appConfig.providerId,
        eventType: event,
      },
    });
    return c.json({ ok: false, error: "bad signature" }, 401);
  }

  const parsed = Result.try({
    try: () => JSON.parse(new TextDecoder().decode(rawBody)) as unknown,
    catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
  });
  if (parsed.isErr()) {
    return c.json({ ok: false, error: "invalid JSON" }, 400);
  }

  const dispatched = await Result.tryPromise({
    try: () => handleGithubWebhook({ event, payload: parsed.value, deliveryId }),
    catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
  });
  if (dispatched.isErr()) {
    const parsedErr = parseError(dispatched.error);
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

  log.info({
    github: {
      event: `webhook.${event}`,
      deliveryId,
      result: dispatched.value,
    },
  });
  return c.json({ ok: true, result: dispatched.value });
};

// ─── Signature verification ──────────────────────────────────────────

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
  const actual = bytesToHex(new Uint8Array(macBuf));

  return timingSafeEqual(expected, actual);
}
