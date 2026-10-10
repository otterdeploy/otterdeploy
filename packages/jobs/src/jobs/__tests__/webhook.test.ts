/**
 * Integration coverage for the guarded webhook delivery path
 * (`deliverWebhookHttp`, wired into the `webhook.deliver` job handler).
 * These drive real literal-IP targets through the real egress policy (no
 * DNS/transport mocking needed. A forbidden literal address is rejected
 * before any socket opens), proving a denied destination fails CLOSED with
 * a clear, operator-readable error rather than throwing an unhandled
 * exception, hanging, or silently no-oping.
 *
 * Same `bun test` + `mock.module` pattern as reconcile.test.ts /
 * notification-inbox.test.ts: @otterdeploy/db is stubbed so this file
 * doesn't need Postgres (deliverWebhookHttp itself does no DB access, but
 * webhook.ts's module-level imports pull in @otterdeploy/db).
 */
import { beforeAll, describe, expect, mock, test } from "bun:test";

let deliverWebhookHttp: typeof import("../webhook").deliverWebhookHttp;
let webhookRequestHeaders: typeof import("../webhook").webhookRequestHeaders;
let deliveryFailure: typeof import("../webhook").deliveryFailure;

beforeAll(async () => {
  await mock.module("@otterdeploy/db", () => ({ db: {} }));
  const realSchema = await import("@otterdeploy/db/schema");
  await mock.module("@otterdeploy/db/schema", () => ({ ...realSchema }));
  // `../delivery/egress-denylist` (imported statically by webhook.ts) reads
  // @otterdeploy/env/server, which validates process.env eagerly at import
  // time: stub it out rather than provide real DATABASE_URL/REDIS_URL/etc.
  // None of these tests call controlPlaneEgressDenylist()/egressAllowlist(),
  // so an empty stub is enough.
  await mock.module("@otterdeploy/env/server", () => ({ env: {} }));
  ({ deliverWebhookHttp, webhookRequestHeaders, deliveryFailure } = await import("../webhook"));
});

describe("deliverWebhookHttp: fails closed against denied targets", () => {
  test("loopback target is denied without a socket ever opening", async () => {
    const outcome = await deliverWebhookHttp({
      url: "http://127.0.0.1:1/hook",
      body: "{}",
      headers: { "content-type": "application/json" },
    });
    expect(outcome.statusCode).toBeNull();
    expect(outcome.error).toBeTruthy();
    expect(outcome.error).toContain("blocked by outbound egress policy");
  });

  test("cloud metadata target is denied", async () => {
    const outcome = await deliverWebhookHttp({
      url: "http://169.254.169.254/latest/meta-data/",
      body: "{}",
      headers: {},
    });
    expect(outcome.statusCode).toBeNull();
    expect(outcome.error).toContain("blocked by outbound egress policy");
  });

  test("RFC1918 private target is denied", async () => {
    const outcome = await deliverWebhookHttp({
      url: "http://10.0.0.5/hook",
      body: "{}",
      headers: {},
    });
    expect(outcome.statusCode).toBeNull();
    expect(outcome.error).toContain("blocked by outbound egress policy");
  });

  test("IPv6 unique-local target is denied", async () => {
    const outcome = await deliverWebhookHttp({
      url: "http://[fc00::1]/hook",
      body: "{}",
      headers: {},
    });
    expect(outcome.statusCode).toBeNull();
    expect(outcome.error).toContain("blocked by outbound egress policy");
  });

  test("a host explicitly on the control-plane deny list is denied even though its address would otherwise be public", async () => {
    const outcome = await deliverWebhookHttp({
      url: "https://deploy.example/hook",
      body: "{}",
      headers: {},
      denyHosts: ["deploy.example"],
    });
    expect(outcome.statusCode).toBeNull();
    expect(outcome.error).toContain("blocked by outbound egress policy");
    expect(outcome.error).toContain("control plane");
  });

  test("a homelab target explicitly allowlisted is no longer denied by the address check (still fails, because nothing is actually listening, but not with an address-denial error)", async () => {
    const outcome = await deliverWebhookHttp({
      url: "http://10.0.0.5:1/hook",
      body: "{}",
      headers: {},
      allowAddresses: ["10.0.0.5"],
      timeoutMs: 500,
    });
    // Not denied at the address-check step. It fails for a different
    // reason (nothing listening / connection refused / timeout), proving
    // the allowlist carve-out actually took effect rather than the address
    // check rejecting 10.0.0.5 outright.
    expect(outcome.error).not.toContain("resolves to a non-public address");
  });

  test("the control-plane's own denied address wins even when also allowlisted", async () => {
    const outcome = await deliverWebhookHttp({
      url: "http://10.0.0.5/hook",
      body: "{}",
      headers: {},
      denyAddresses: ["10.0.0.5"],
      allowAddresses: ["10.0.0.5"],
    });
    expect(outcome.statusCode).toBeNull();
    expect(outcome.error).toContain("blocked by outbound egress policy");
  });
});

describe("outbound deliveries are signed with a timestamp", () => {
  const body = JSON.stringify({ event: "deploy.succeeded" });
  const input = {
    secret: "whsec_test",
    body,
    event: "deploy.succeeded",
    deliveryId: "42",
    timestamp: 1_760_000_000,
  };

  test("carries webhook-id/-timestamp/-signature that verify, and the older header", async () => {
    const { verifyWebhook } = await import("@otterdeploy/shared/webhook-signature");
    const { hmacSha256Hex } = await import("@otterdeploy/shared/crypto");
    const headers = await webhookRequestHeaders(input);
    expect(headers["webhook-id"]).toBe("42");
    expect(headers["webhook-timestamp"]).toBe("1760000000");
    const verified = await verifyWebhook("whsec_test", {
      id: headers["webhook-id"],
      timestamp: headers["webhook-timestamp"],
      signature: headers["webhook-signature"],
      body,
      nowSeconds: 1_760_000_010,
    });
    expect(verified.ok).toBe(true);
    // Receivers that verify the body-only signature keep working.
    expect(headers["X-Otterdeploy-Signature"]).toBe(
      `sha256=${await hmacSha256Hex("whsec_test", body)}`,
    );
  });

  test("a retry keeps the id and is signed at its own time", async () => {
    const first = await webhookRequestHeaders(input);
    const retry = await webhookRequestHeaders({ ...input, timestamp: input.timestamp + 40 });
    expect(retry["webhook-id"]).toBe(first["webhook-id"]);
    expect(retry["webhook-signature"]).not.toBe(first["webhook-signature"]);
  });

  test("410 Gone is final; every other failure is retried", async () => {
    const { UnrecoverableError } = await import("bullmq");
    expect(deliveryFailure(410, "HTTP 410")).toBeInstanceOf(UnrecoverableError);
    expect(deliveryFailure(500, "HTTP 500")).not.toBeInstanceOf(UnrecoverableError);
    expect(deliveryFailure(null, "timeout")).not.toBeInstanceOf(UnrecoverableError);
  });
});
