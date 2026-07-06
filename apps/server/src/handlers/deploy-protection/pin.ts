/**
 * Access-PIN entry (NetBird-style): the wall page offers a numeric PIN field
 * when the protected route has one configured; a correct entry mints the
 * host-only __otter_pin cookie. Split out of ./guest (email OTP) — same
 * conventions: guarded handler, JSON in/out, rate-limited, never leaks
 * whether the failure was "no PIN configured" vs "wrong PIN".
 */

import type { Context, Handler } from "hono";

import { resolveProtectedDomainOrg } from "@otterdeploy/api/authz/membership";
import {
  pinFingerprint,
  underPinRateLimit,
  verifyPinAgainstHash,
} from "@otterdeploy/api/authz/pin";
import { signPinCookie, verifyPinCookie } from "@otterdeploy/api/authz/tokens";
import { log } from "evlog";
import { getCookie, setCookie } from "hono/cookie";

import {
  clientIpOf,
  cookieOptions,
  guard,
  hostOf,
  PIN_COOKIE,
  PIN_COOKIE_MAX_AGE,
  sanitizePath,
} from "./shared";

/** forward_auth helper: true when the request carries a valid pin cookie
 *  whose fingerprint matches the route's CURRENT hash — so a rotated or
 *  removed PIN revokes every outstanding cookie on the next request. */
export async function pinCookieAllows(
  c: Context,
  domain: string,
  accessPinHash: string | null,
): Promise<boolean> {
  if (!accessPinHash) return false;
  const cookie = getCookie(c, PIN_COOKIE);
  const claims = cookie ? await verifyPinCookie(cookie, domain) : null;
  return claims !== null && claims.k === (await pinFingerprint(accessPinHash));
}

/** Verify a PIN → mint the deployment-scoped pin cookie. One error shape for
 *  every failure (unknown domain, PIN off, rate-limited, wrong PIN) so the
 *  form can't be used to probe configuration. */
export const deployPinVerifyHandler: Handler = guard(
  async (c) => {
    const host = hostOf(c.req.header("host"));
    const body = await c.req.json().catch(() => ({}) as Record<string, unknown>);
    const pin = typeof body.pin === "string" ? body.pin.trim() : "";
    const returnPath = sanitizePath(typeof body.return === "string" ? body.return : "/");
    if (!host || !/^\d{4,8}$/.test(pin)) {
      return c.json({ ok: false, error: "Invalid PIN" }, 401);
    }

    // Count the attempt BEFORE verifying — a capped window per (domain, ip)
    // is what makes the small numeric space safe against online guessing.
    if (!(await underPinRateLimit(host, clientIpOf(c)))) {
      return c.json({ ok: false, error: "Too many attempts — try again later" }, 429);
    }

    const org = await resolveProtectedDomainOrg(host);
    if (!org?.accessPinHash || !(await verifyPinAgainstHash(pin, org.accessPinHash))) {
      return c.json({ ok: false, error: "Invalid PIN" }, 401);
    }

    setCookie(
      c,
      PIN_COOKIE,
      await signPinCookie(host, await pinFingerprint(org.accessPinHash), PIN_COOKIE_MAX_AGE),
      cookieOptions(PIN_COOKIE_MAX_AGE),
    );
    log.info({ deployProtection: { event: "pin-in", domain: host } });
    return c.json({ ok: true, redirect: returnPath });
  },
  (c) => c.json({ ok: false, error: "Something went wrong" }, 500),
);
