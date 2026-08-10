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

beforeAll(async () => {
  mock.module("@otterdeploy/db", () => ({ db: {} }));
  const realSchema = await import("@otterdeploy/db/schema");
  mock.module("@otterdeploy/db/schema", () => ({ ...realSchema }));
  // `../delivery/egress-denylist` (imported statically by webhook.ts) reads
  // @otterdeploy/env/server, which validates process.env eagerly at import
  // time: stub it out rather than provide real DATABASE_URL/REDIS_URL/etc.
  // None of these tests call controlPlaneEgressDenylist()/egressAllowlist(),
  // so an empty stub is enough.
  mock.module("@otterdeploy/env/server", () => ({ env: {} }));
  ({ deliverWebhookHttp } = await import("../webhook"));
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
