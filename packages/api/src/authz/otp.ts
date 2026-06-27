/**
 * Email OTP store for guest deployment access (Cloudflare-Access one-time
 * PIN). Codes live in Redis with a short TTL, are single-use, and requests
 * are rate-limited per (domain, email). The wall never reveals whether an
 * email is on the allow-list — callers always respond the same.
 */

import type { RedisClient } from "bun";

import { timingSafeEqual } from "@otterdeploy/shared/crypto";

import { createRedis } from "../lib/redis";

const OTP_TTL_SECONDS = 10 * 60;
const OTP_DIGITS = 6;
const MAX_REQUESTS_PER_WINDOW = 5;
const RATE_WINDOW_SECONDS = 15 * 60;
/** Wrong-guess cap per issued code. Without it the 6-digit (10^6) space is
 *  brute-forceable inside the 10-minute TTL; exhausting it burns the code. */
const MAX_VERIFY_ATTEMPTS = 5;

let client: RedisClient | null = null;
function redis(): RedisClient {
  if (!client) client = createRedis();
  return client;
}

const norm = (email: string) => email.trim().toLowerCase();
const otpKey = (domain: string, email: string) => `otp:guest:${domain}:${norm(email)}`;
const rateKey = (domain: string, email: string) => `otp:rate:${domain}:${norm(email)}`;
const tryKey = (domain: string, email: string) => `otp:try:${domain}:${norm(email)}`;

/** 6-digit numeric code, crypto-random. */
export function generateOtp(): string {
  const n = crypto.getRandomValues(new Uint32Array(1))[0]! % 1_000_000;
  return n.toString().padStart(OTP_DIGITS, "0");
}

export async function storeOtp(domain: string, email: string, code: string): Promise<void> {
  const r = redis();
  const key = otpKey(domain, email);
  await r.set(key, code);
  await r.expire(key, OTP_TTL_SECONDS);
}

/** Increment the per-(domain,email) request counter; true = still under the
 *  limit. First request in a window sets the expiry. */
export async function underRateLimit(domain: string, email: string): Promise<boolean> {
  const r = redis();
  const key = rateKey(domain, email);
  const count = await r.incr(key);
  if (count === 1) await r.expire(key, RATE_WINDOW_SECONDS);
  return count <= MAX_REQUESTS_PER_WINDOW;
}

/** Verify and consume (single-use). Returns false on mismatch/expiry. Caps
 *  wrong guesses per code (anti-brute-force) and compares in constant time. */
export async function consumeOtp(domain: string, email: string, code: string): Promise<boolean> {
  const r = redis();
  const key = otpKey(domain, email);
  const stored = await r.get(key);
  if (!stored) return false;

  // Count the attempt before comparing; once the cap is hit, burn the code so
  // no further guesses (correct or not) succeed. Counter shares the OTP TTL.
  const tries = await r.incr(tryKey(domain, email));
  if (tries === 1) await r.expire(tryKey(domain, email), OTP_TTL_SECONDS);
  if (tries > MAX_VERIFY_ATTEMPTS) {
    await r.del(key);
    await r.del(tryKey(domain, email));
    return false;
  }

  if (!timingSafeEqual(stored, code.trim())) return false;
  await r.del(key);
  await r.del(tryKey(domain, email));
  return true;
}
