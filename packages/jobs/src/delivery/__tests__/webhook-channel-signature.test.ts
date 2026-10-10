/**
 * A webhook notification channel with a secret signs each POST
 * with a timestamp (webhook-id / webhook-timestamp / webhook-signature over
 * id.timestamp.body), so its receiver can refuse a replay; the older body-only
 * x-otterdeploy-signature is kept for receivers that verify it.
 */
import { hmacSha256Hex } from "@otterdeploy/shared/crypto";
import { Temporal } from "@otterdeploy/shared/temporal";
import { verifyWebhook } from "@otterdeploy/shared/webhook-signature";
import { describe, expect, test } from "bun:test";

import { webhookChannelHeaders } from "../webhook-headers";

const BODY = JSON.stringify({ event: "deploy.failed" });

describe("webhook channel signing", () => {
  test("a channel with a secret sends a timestamped signature that verifies", async () => {
    const headers = await webhookChannelHeaders("chan-secret", BODY, {
      id: "evt_1",
      timestamp: 1_760_000_000,
    });
    const verified = await verifyWebhook("chan-secret", {
      id: headers["webhook-id"],
      timestamp: headers["webhook-timestamp"],
      signature: headers["webhook-signature"],
      body: BODY,
      nowSeconds: 1_760_000_005,
    });
    expect(verified.ok).toBe(true);
    expect(headers["x-otterdeploy-signature"]).toBe(
      `sha256=${await hmacSha256Hex("chan-secret", BODY)}`,
    );
  });

  test("each delivery gets its own id and the current time by default", async () => {
    const first = await webhookChannelHeaders("chan-secret", BODY);
    const second = await webhookChannelHeaders("chan-secret", BODY);
    expect(first["webhook-id"]).not.toBe(second["webhook-id"]);
    const now = Math.floor(Temporal.Now.instant().epochMilliseconds / 1000);
    expect(Math.abs(Number(first["webhook-timestamp"]) - now)).toBeLessThan(5);
  });

  test("a channel without a secret sends no signature headers", async () => {
    expect(await webhookChannelHeaders(null, BODY)).toEqual({
      "content-type": "application/json",
    });
  });
});
