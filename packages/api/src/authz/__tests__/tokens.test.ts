import { beforeAll, describe, expect, test } from "vite-plus/test";

// HMAC key is derived from BETTER_AUTH_SECRET — set one before importing.
beforeAll(() => {
  // oxlint-disable-next-line node/no-process-env -- test env setup boundary: HMAC key derives from this secret; set before importing tokens.
  process.env.BETTER_AUTH_SECRET ??= "test-secret-test-secret-test-secret-0123456789";
});

const {
  signHandoffToken,
  verifyHandoffToken,
  signSessionCookie,
  verifySessionCookie,
  signGrantToken,
  verifyGrantToken,
  signGuestCookie,
  verifyGuestCookie,
} = await import("../tokens");

const claims = {
  userId: "user_1",
  orgId: "org_1",
  email: "a@b.com",
  domain: "plane.com",
};

describe("authz tokens", () => {
  test("session cookie round-trips for the bound domain", async () => {
    const token = await signSessionCookie(claims);
    const out = await verifySessionCookie(token, "plane.com");
    expect(out).toEqual(claims);
  });

  test("handoff token round-trips and carries return + nonce", async () => {
    const token = await signHandoffToken({ ...claims, return: "/app", nonce: "n1" });
    const out = await verifyHandoffToken(token, "plane.com");
    expect(out).toMatchObject({ ...claims, return: "/app", nonce: "n1" });
  });

  test("domain binding: a token for plane.com is rejected on autodeploy.com", async () => {
    const token = await signSessionCookie(claims);
    expect(await verifySessionCookie(token, "autodeploy.com")).toBeNull();
  });

  test("purpose separation: a handoff token is not valid as a session cookie", async () => {
    const handoff = await signHandoffToken({ ...claims, return: "/", nonce: "n" });
    expect(await verifySessionCookie(handoff, "plane.com")).toBeNull();
  });

  test("tampered signature is rejected", async () => {
    const token = await signSessionCookie(claims);
    const tampered = token.slice(0, -2) + (token.endsWith("aa") ? "bb" : "aa");
    expect(await verifySessionCookie(tampered, "plane.com")).toBeNull();
  });

  test("garbage / malformed token verifies to null, never throws", async () => {
    expect(await verifySessionCookie("not-a-token", "plane.com")).toBeNull();
    expect(await verifySessionCookie("", "plane.com")).toBeNull();
  });

  test("share grant: round-trips, domain-bound, purpose-separated", async () => {
    const token = await signGrantToken("share", "plane.com", 3600);
    expect(await verifyGrantToken(token, "share", "plane.com")).toBe(true);
    expect(await verifyGrantToken(token, "share", "autodeploy.com")).toBe(false);
    expect(await verifyGrantToken(token, "bypass", "plane.com")).toBe(false);
  });

  test("bypass grant: round-trips and is rejected once expired", async () => {
    const ok = await signGrantToken("bypass", "plane.com", 3600);
    expect(await verifyGrantToken(ok, "bypass", "plane.com")).toBe(true);
    const expired = await signGrantToken("bypass", "plane.com", -1);
    expect(await verifyGrantToken(expired, "bypass", "plane.com")).toBe(false);
  });

  test("guest cookie: round-trips, domain-bound, not usable as a session", async () => {
    const token = await signGuestCookie("guest@x.com", "plane.com", 3600);
    expect(await verifyGuestCookie(token, "plane.com")).toEqual({
      email: "guest@x.com",
      domain: "plane.com",
    });
    expect(await verifyGuestCookie(token, "autodeploy.com")).toBeNull();
    // purpose separation: a guest cookie isn't a member session cookie
    expect(await verifySessionCookie(token, "plane.com")).toBeNull();
  });
});
