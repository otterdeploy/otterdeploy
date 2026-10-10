/**
 * Guest OTP codes and the OTP / PIN rate windows get their expiry in the SAME
 * Redis step that writes them.
 *
 * They used to write the value, then set the TTL in a second call (SET then
 * EXPIRE; INCR then EXPIRE on the first hit). Anything failing between the two
 * left a key with no TTL: an OTP that never expired, or a rate window that
 * never reset, a permanent lockout for that email or IP. Here the separate
 * EXPIRE call fails outright, the failure the two-call form could not survive,
 * and every key must still carry its TTL.
 */
import { RedisClient } from "bun";
import { afterAll, afterEach, describe, expect, it, vi } from "vite-plus/test";

/* oxlint-disable node/no-process-env -- test module graph setup: the real Redis under test */
process.env.REDIS_URL = process.env.INTEGRATION_REDIS_URL ?? process.env.REDIS_URL;
const raw = new RedisClient(process.env.REDIS_URL);
/* oxlint-enable node/no-process-env */

const { storeOtp, underRateLimit, consumeOtp } = await import("../otp");
const { underPinRateLimit } = await import("../pin");

afterAll(() => raw.close());
afterEach(() => {
  vi.restoreAllMocks();
});

const uid = () => crypto.randomUUID().slice(0, 12);

/** A separate EXPIRE never lands: the blip between two calls. */
function failSeparateExpire(): void {
  vi.spyOn(RedisClient.prototype, "expire").mockRejectedValue(new Error("connection reset"));
}

async function expectTtl(key: string, bound: number): Promise<void> {
  const ttl = await raw.ttl(key);
  expect(ttl, `${key}: -1 is no expiry, -2 is no key`).toBeGreaterThan(0);
  expect(ttl).toBeLessThanOrEqual(bound);
}

describe("keys carry their TTL even when a separate EXPIRE would fail", () => {
  it("a stored OTP code", async () => {
    failSeparateExpire();
    const domain = `app-${uid()}.example.com`;
    await storeOtp(domain, "g@example.com", "123456");
    await expectTtl(`otp:guest:${domain}:g@example.com`, 10 * 60);
  });

  it("the OTP request window", async () => {
    failSeparateExpire();
    const domain = `app-${uid()}.example.com`;
    expect(await underRateLimit(domain, "g@example.com")).toBe(true);
    await expectTtl(`otp:rate:${domain}:g@example.com`, 15 * 60);
  });

  it("the OTP wrong-guess counter", async () => {
    const domain = `app-${uid()}.example.com`;
    await storeOtp(domain, "g@example.com", "123456");
    failSeparateExpire();
    expect(await consumeOtp(domain, "g@example.com", "000000")).toBe(false);
    await expectTtl(`otp:try:${domain}:g@example.com`, 10 * 60);
  });

  it("the PIN guess window", async () => {
    failSeparateExpire();
    const domain = `app-${uid()}.example.com`;
    expect(await underPinRateLimit(domain, "203.0.113.9")).toBe(true);
    await expectTtl(`pin:rate:${domain}:203.0.113.9`, 15 * 60);
  });
});

describe("a window already stranded without a TTL", () => {
  it("heals on its next use instead of locking the address out for good", async () => {
    const domain = `app-${uid()}.example.com`;
    const key = `pin:rate:${domain}:198.51.100.7`;
    // What the two-call form left behind: a counter with no expiry.
    await raw.set(key, "3");
    expect(await raw.ttl(key)).toBe(-1);
    expect(await underPinRateLimit(domain, "198.51.100.7")).toBe(true);
    await expectTtl(key, 15 * 60);
  });
});
