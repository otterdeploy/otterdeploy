import { hmacSha256Hex } from "@otterdeploy/shared/crypto";
import { describe, expect, test } from "vite-plus/test";

import {
  mintInboundSecret,
  mintInboundToken,
  mintWebhookSecret,
  signPayload,
  verifySignatureHeader,
} from "../signature";

const SECRET = "whsec_0123456789abcdef";
const BODY = JSON.stringify({ event: "deploy.succeeded", data: { project: "web" } });

describe("signPayload / verifySignatureHeader", () => {
  test("round-trips: a signed payload verifies against the same secret + body", async () => {
    const header = await signPayload(SECRET, BODY);
    expect(header).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(await verifySignatureHeader(SECRET, header, BODY)).toBe(true);
  });

  test("string and ArrayBuffer bodies produce the same signature", async () => {
    const buf = new TextEncoder().encode(BODY).buffer as ArrayBuffer;
    expect(await signPayload(SECRET, buf)).toBe(await signPayload(SECRET, BODY));
    const header = await signPayload(SECRET, BODY);
    expect(await verifySignatureHeader(SECRET, header, buf)).toBe(true);
  });

  test("matches a known HMAC-SHA256 test vector (RFC 4231 case 2)", async () => {
    // HMAC-SHA256("Jefe", "what do ya want for nothing?")
    expect(await hmacSha256Hex("Jefe", "what do ya want for nothing?")).toBe(
      "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843",
    );
  });

  test("rejects a tampered body", async () => {
    const header = await signPayload(SECRET, BODY);
    expect(await verifySignatureHeader(SECRET, header, `${BODY} `)).toBe(false);
  });

  test("rejects the wrong secret", async () => {
    const header = await signPayload(SECRET, BODY);
    expect(await verifySignatureHeader("whsec_other", header, BODY)).toBe(false);
  });

  test("rejects a missing / empty / unprefixed header", async () => {
    expect(await verifySignatureHeader(SECRET, null, BODY)).toBe(false);
    expect(await verifySignatureHeader(SECRET, undefined, BODY)).toBe(false);
    expect(await verifySignatureHeader(SECRET, "", BODY)).toBe(false);
    const bare = (await signPayload(SECRET, BODY)).slice("sha256=".length);
    expect(await verifySignatureHeader(SECRET, bare, BODY)).toBe(false);
    expect(await verifySignatureHeader(SECRET, `md5=${bare}`, BODY)).toBe(false);
  });

  test("accepts uppercase hex in the header (case-tolerant)", async () => {
    const header = await signPayload(SECRET, BODY);
    const upper = `sha256=${header.slice("sha256=".length).toUpperCase()}`;
    expect(await verifySignatureHeader(SECRET, upper, BODY)).toBe(true);
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
