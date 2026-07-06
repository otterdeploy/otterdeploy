/**
 * Access-PIN support for deployment protection (NetBird-style): the operator
 * sets a short numeric code on a protected route; anyone who enters it on the
 * wall page gets a time-boxed, deployment-scoped cookie — no org account or
 * email invite.
 *
 * Storage is an argon2 hash on the proxy_route row (Bun.password — memory-hard
 * so the ~10^6 PIN space can't be cheaply brute-forced offline if the hash ever
 * leaks). Online guessing is capped by a Redis rate limit per (domain, client
 * IP). The minted cookie carries a FINGERPRINT of the current hash, so
 * rotating or removing the PIN invalidates every outstanding cookie on the
 * next request — no waiting out the TTL.
 */

import type { RedisClient } from "bun";

import { createRedis } from "../lib/redis";

/** Wrong-guess budget per (domain, ip) window. A 6-digit PIN has 10^6
 *  combinations; 10 tries per 15 minutes makes online guessing hopeless. */
const MAX_ATTEMPTS_PER_WINDOW = 10;
const RATE_WINDOW_SECONDS = 15 * 60;

let client: RedisClient | null = null;
function redis(): RedisClient {
  if (!client) client = createRedis();
  return client;
}

const rateKey = (domain: string, ip: string) => `pin:rate:${domain}:${ip}`;

/** Argon2 hash for storage. */
export async function hashPin(pin: string): Promise<string> {
  return Bun.password.hash(pin);
}

/** Constant-time-ish verify against the stored argon2 hash. */
export async function verifyPinAgainstHash(pin: string, hash: string): Promise<boolean> {
  return Bun.password.verify(pin, hash);
}

/** Short digest of the stored hash, embedded in the pin cookie. The authz
 *  gate compares it to the CURRENT hash's fingerprint, so a rotated/removed
 *  PIN kills all outstanding cookies immediately. Not secret — it's a hash
 *  of a salted argon2 string, useless without the cookie's HMAC. */
export async function pinFingerprint(hash: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(hash));
  return Buffer.from(digest).toString("base64url").slice(0, 16);
}

/** Increment the per-(domain, ip) attempt counter; true = still under the
 *  limit. First attempt in a window sets the expiry (same pattern as the
 *  guest-OTP limiter in ./otp.ts). */
export async function underPinRateLimit(domain: string, ip: string): Promise<boolean> {
  const r = redis();
  const key = rateKey(domain, ip);
  const count = await r.incr(key);
  if (count === 1) await r.expire(key, RATE_WINDOW_SECONDS);
  return count <= MAX_ATTEMPTS_PER_WINDOW;
}
