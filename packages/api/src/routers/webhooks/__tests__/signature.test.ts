import { hmacSha256Hex } from "@otterdeploy/shared/crypto";
import {
  signWebhook,
  verifyWebhook,
  WEBHOOK_TOLERANCE_SECONDS,
  webhookSignatureHeaders,
} from "@otterdeploy/shared/webhook-signature";
import { describe, expect, test } from "vite-plus/test";

import { mintInboundSecret, mintInboundToken, mintWebhookSecret } from "../signature";

const SECRET = "whsec_0123456789abcdef";
const BODY = JSON.stringify({ event: "deploy.succeeded", data: { project: "web" } });
const NOW = 1_760_000_000;
const MESSAGE = { id: "msg_1", timestamp: NOW, body: BODY };

function verify(overrides: Partial<Parameters<typeof verifyWebhook>[1]> & { signature: string }) {
  return verifyWebhook(SECRET, {
    id: MESSAGE.id,
    timestamp: String(NOW),
    body: BODY,
    nowSeconds: NOW,
    ...overrides,
  });
}

describe("timestamped webhook signatures", () => {
  test("round-trips: a signed message verifies against the same secret, id, timestamp and body", async () => {
    const signature = await signWebhook(SECRET, MESSAGE);
    expect(signature).toMatch(/^v1,[A-Za-z0-9+/]{43}=$/);
    expect(await verify({ signature })).toEqual({ ok: true, id: "msg_1", timestamp: NOW });
  });

  test("signs id.timestamp.body with the secret's bytes (openssl-reproducible)", async () => {
    // printf '%s' "msg_1.<ts>.<body>" | openssl dgst -sha256 -hmac "$SECRET" -binary | base64
    const hex = await hmacSha256Hex(SECRET, `msg_1.${NOW}.${BODY}`);
    const base64 = btoa(
      String.fromCharCode(...(hex.match(/../g) ?? []).map((b) => parseInt(b, 16))),
    );
    expect(await signWebhook(SECRET, MESSAGE)).toBe(`v1,${base64}`);
  });

  test("string and ArrayBuffer bodies produce the same signature", async () => {
    const bytes = new TextEncoder().encode(BODY);
    const buf = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(buf).set(bytes);
    expect(await signWebhook(SECRET, { ...MESSAGE, body: buf })).toBe(
      await signWebhook(SECRET, MESSAGE),
    );
  });

  test("the timestamp and id are part of what is signed", async () => {
    const signature = await signWebhook(SECRET, MESSAGE);
    expect(await verify({ signature, timestamp: String(NOW + 1) })).toMatchObject({
      ok: false,
      reason: "invalid-signature",
    });
    expect(await verify({ signature, id: "msg_2" })).toMatchObject({
      ok: false,
      reason: "invalid-signature",
    });
  });

  test("rejects a tampered body and the wrong secret", async () => {
    const signature = await signWebhook(SECRET, MESSAGE);
    expect(await verify({ signature, body: `${BODY} ` })).toMatchObject({ ok: false });
    expect(
      await verifyWebhook("whsec_other", {
        id: MESSAGE.id,
        timestamp: String(NOW),
        signature,
        body: BODY,
        nowSeconds: NOW,
      }),
    ).toMatchObject({ ok: false, reason: "invalid-signature" });
  });

  test("a captured request stops verifying once its timestamp leaves the window", async () => {
    const signature = await signWebhook(SECRET, MESSAGE);
    expect(await verify({ signature, nowSeconds: NOW + WEBHOOK_TOLERANCE_SECONDS })).toMatchObject({
      ok: true,
    });
    expect(
      await verify({ signature, nowSeconds: NOW + WEBHOOK_TOLERANCE_SECONDS + 1 }),
    ).toMatchObject({ ok: false, reason: "timestamp-too-old" });
    expect(
      await verify({ signature, nowSeconds: NOW - WEBHOOK_TOLERANCE_SECONDS - 1 }),
    ).toMatchObject({ ok: false, reason: "timestamp-too-new" });
  });

  test("rejects missing headers, a non-numeric timestamp, and the old sha256= scheme", async () => {
    const signature = await signWebhook(SECRET, MESSAGE);
    expect(await verify({ signature, id: null })).toMatchObject({ reason: "missing-headers" });
    expect(await verify({ signature: "" })).toMatchObject({ reason: "missing-headers" });
    expect(await verify({ signature, timestamp: "2026-01-01T00:00:00Z" })).toMatchObject({
      reason: "invalid-timestamp",
    });
    const legacy = `sha256=${await hmacSha256Hex(SECRET, BODY)}`;
    expect(await verify({ signature: legacy })).toMatchObject({ reason: "invalid-signature" });
  });

  test("any one valid v1 signature in a space-separated list verifies (key rotation)", async () => {
    const good = await signWebhook(SECRET, MESSAGE);
    const other = await signWebhook("whsec_previous", MESSAGE);
    expect(await verify({ signature: `${other} ${good}` })).toMatchObject({ ok: true });
  });

  test("webhookSignatureHeaders carries all three headers", async () => {
    const headers = await webhookSignatureHeaders(SECRET, MESSAGE);
    expect(headers).toEqual({
      "webhook-id": "msg_1",
      "webhook-timestamp": String(NOW),
      "webhook-signature": await signWebhook(SECRET, MESSAGE),
    });
  });
});

describe("credential minting", () => {
  test("shapes: whsec_/inhsec_ prefixes, 64 hex chars; token is 40 hex chars", () => {
    expect(mintWebhookSecret()).toMatch(/^whsec_[0-9a-f]{64}$/);
    expect(mintInboundSecret()).toMatch(/^inhsec_[0-9a-f]{64}$/);
    expect(mintInboundToken()).toMatch(/^[0-9a-f]{40}$/);
  });

  test("mints are unique across calls", () => {
    expect(mintWebhookSecret()).not.toBe(mintWebhookSecret());
    expect(mintInboundToken()).not.toBe(mintInboundToken());
  });
});
