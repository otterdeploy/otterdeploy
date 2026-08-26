/**
 * Cookieless visitor identity (docs/designs/web-analytics.md §4.2, §8).
 *
 * `visitor_id = HMAC-SHA256(k, site|utcDay|ip|browser|os|device)[:16 bytes]`
 * where `k` is derived once per process from BETTER_AUTH_SECRET via HKDF.
 * The UTC day is part of the message, so the hash rotates at midnight by
 * construction: no per-visitor row ever stores an IP, and the same visitor
 * hashes to the same value across restarts (unlike the traffic plane's
 * per-process salt), which is what makes the DB session fallback work.
 *
 * Pure: no DB, no clock. The only environment read is the secret, memoised
 * on first use so tests can import this without an env round trip per hash.
 */

import type { AnalyticsSiteId } from "@otterdeploy/shared/id";

import { env } from "@otterdeploy/env/server";
import { Temporal } from "@otterdeploy/shared/temporal";
import { createHmac, hkdfSync } from "node:crypto";

const HKDF_SALT = "otterdeploy-analytics";
const VISITOR_INFO = "otterdeploy/analytics/visitor/v1";
const EXTERNAL_USER_INFO = "otterdeploy/analytics/external-user/v1";
const KEY_BYTES = 32;
/** 16 bytes → 32 hex chars, plenty of entropy for a per-day identifier. */
const HASH_BYTES = 16;

let visitorKey: Buffer | null = null;
let externalUserKey: Buffer | null = null;

function deriveKey(info: string): Buffer {
  return Buffer.from(
    hkdfSync(
      "sha256",
      Buffer.from(env.BETTER_AUTH_SECRET, "utf8"),
      Buffer.from(HKDF_SALT, "utf8"),
      Buffer.from(info, "utf8"),
      KEY_BYTES,
    ),
  );
}

function hmacHex(key: Buffer, message: string): string {
  return createHmac("sha256", key)
    .update(message, "utf8")
    .digest()
    .subarray(0, HASH_BYTES)
    .toString("hex");
}

export interface VisitorHashInput {
  siteId: AnalyticsSiteId;
  /** `YYYY-MM-DD` in UTC, see `utcDayOf`. */
  utcDay: string;
  ip: string;
  browser: string;
  os: string;
  device: string;
}

/** Daily-rotating, site-scoped visitor hash: 32 lowercase hex chars. */
export function visitorHash(input: VisitorHashInput): string {
  visitorKey ??= deriveKey(VISITOR_INFO);
  const message = [
    input.siteId,
    input.utcDay,
    input.ip,
    input.browser,
    input.os,
    input.device,
  ].join("|");
  return hmacHex(visitorKey, message);
}

/** `identify(id)` → site-scoped HMAC so the caller's user id is never stored
 *  in clear, yet stays joinable across days (it does not rotate). */
export function externalUserHash(siteId: AnalyticsSiteId, uid: string): string {
  externalUserKey ??= deriveKey(EXTERNAL_USER_INFO);
  return hmacHex(externalUserKey, `${siteId}|${uid}`);
}

/** UTC calendar day (`YYYY-MM-DD`) an epoch-ms timestamp falls on. */
export function utcDayOf(epochMs: number): string {
  return Temporal.Instant.fromEpochMilliseconds(epochMs)
    .toZonedDateTimeISO("UTC")
    .toPlainDate()
    .toString();
}
