/**
 * Guest access (Cloudflare-style email one-time PIN): the wall page that offers
 * org-login OR email-code entry, plus the OTP request/verify routes. Split out
 * of deploy-protection.tsx; the three handlers are re-exported from that module
 * so the public import path (`./deploy-protection`) is unchanged.
 */

import type { Handler } from "hono";

import { guestSessionHoursFor } from "@otterdeploy/api/authz/guests";
import { resolveProtectedDomainOrg } from "@otterdeploy/api/authz/membership";
import { consumeOtp, generateOtp, storeOtp, underRateLimit } from "@otterdeploy/api/authz/otp";
import { signGuestCookie } from "@otterdeploy/api/authz/tokens";
import { sendEmail } from "@otterdeploy/email";
import { env } from "@otterdeploy/env/server";
import { Result } from "better-result";
import { log } from "evlog";
import { setCookie } from "hono/cookie";

import {
  cookieOptions,
  errorPage,
  escapeHtml,
  guard,
  GUEST_COOKIE,
  GUEST_COOKIE_MAX_AGE,
  hostOf,
  sanitizePath,
  serverError,
} from "./shared";
import { AccessWall } from "./ui/wall";

/** On the deployment domain: the wall page — PIN-only when the route has a
 *  PIN configured, otherwise org login OR email-code entry. */
export const deployAccessHandler: Handler = guard(async (c) => {
  const host = hostOf(c.req.header("host"));
  const returnPath = sanitizePath(c.req.query("return"));
  if (!host)
    return errorPage(c, 400, "Bad request", "This request is missing required information.");

  const org = await resolveProtectedDomainOrg(host);
  if (!org)
    return errorPage(
      c,
      404,
      "Deployment not found",
      "This deployment doesn't exist or is no longer protected.",
    );

  // "Continue with organization" → the existing master-session handoff.
  const authorize = new URL("/.well-known/otterdeploy/authorize", env.BETTER_AUTH_URL);
  authorize.searchParams.set("domain", host);
  authorize.searchParams.set("return", returnPath);

  return c.html(
    <AccessWall
      domain={host}
      returnPath={returnPath}
      orgAuthorizeUrl={authorize.toString()}
      hasPin={org.accessPinHash !== null}
    />,
  );
}, serverError);

/** Request an OTP. Always responds 200 — never reveal whether the email is on
 *  the allow-list (anti-enumeration). Sends a code only to invited guests. */
export const deployOtpRequestHandler: Handler = guard(
  async (c) => {
    const host = hostOf(c.req.header("host"));
    const body = await c.req.json().catch(() => ({}) as Record<string, unknown>);
    const email = typeof body.email === "string" ? body.email.trim() : "";
    if (!host || !email) return c.json({ ok: false }, 400);

    // Rate-limit per (domain, email) regardless of allow-list membership.
    if (!(await underRateLimit(host, email))) {
      return c.json({ ok: true }); // same shape — don't leak the limit either
    }

    const hours = await guestSessionHoursFor(host, email);
    if (hours !== null) {
      const code = generateOtp();
      await storeOtp(host, email, code);
      // Fire-and-forget the send. AWAITING it would leak allow-list membership
      // via response timing (invited = slow Resend round-trip); the HTTP
      // response must look identical for invited and uninvited emails. A send
      // failure is logged out of band and never changes the response (also
      // keeps a misconfigured RESEND_API_KEY from 500-ing).
      void Result.tryPromise({
        try: () => sendOtpEmail(email, code, host),
        catch: (cause) => cause,
      }).then((sent) =>
        sent.match({
          ok: () => log.info({ deployProtection: { event: "otp-sent", domain: host } }),
          err: (err) =>
            log.error({
              deployProtection: { event: "otp-send-failed", domain: host },
              error: err instanceof Error ? err.message : String(err),
            }),
        }),
      );
    }
    return c.json({ ok: true });
    // On any unexpected throw, still answer 200 {ok:true}: the response must look
    // identical for invited and uninvited emails (anti-enumeration).
  },
  (c) => c.json({ ok: true }),
);

/** Verify an OTP → mint the deployment-scoped guest cookie (TTL = the guest's
 *  configured session length). */
export const deployOtpVerifyHandler: Handler = guard(
  async (c) => {
    const host = hostOf(c.req.header("host"));
    const body = await c.req.json().catch(() => ({}) as Record<string, unknown>);
    const email = typeof body.email === "string" ? body.email.trim() : "";
    const code = typeof body.code === "string" ? body.code.trim() : "";
    const returnPath = sanitizePath(typeof body.return === "string" ? body.return : "/");
    if (!host || !email || !code) return c.json({ ok: false }, 400);

    // Re-check the allow-list at verify time (it may have changed since request).
    const hours = await guestSessionHoursFor(host, email);
    if (hours === null || !(await consumeOtp(host, email, code))) {
      return c.json({ ok: false, error: "Invalid or expired code" }, 401);
    }

    const ttlSeconds = hours * 60 * 60;
    setCookie(
      c,
      GUEST_COOKIE,
      await signGuestCookie(email.toLowerCase(), host, ttlSeconds),
      cookieOptions(Math.min(ttlSeconds, GUEST_COOKIE_MAX_AGE)),
    );
    log.info({ deployProtection: { event: "guest-in", domain: host } });
    return c.json({ ok: true, redirect: returnPath });
  },
  (c) => c.json({ ok: false, error: "Something went wrong" }, 500),
);

async function sendOtpEmail(email: string, code: string, domain: string): Promise<void> {
  await sendEmail({
    to: email,
    subject: `Your code for ${domain}: ${code}`,
    text: `Your one-time code to access ${domain} is: ${code}\n\nIt expires in 10 minutes. If you didn't request this, ignore this email.`,
    html: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:420px;margin:0 auto;padding:24px">
      <p style="color:#444">Your one-time code to access <b>${escapeHtml(domain)}</b>:</p>
      <p style="font-size:32px;font-weight:700;letter-spacing:6px;font-family:ui-monospace,Menlo,monospace">${code}</p>
      <p style="color:#888;font-size:13px">Expires in 10 minutes. If you didn't request this, ignore this email.</p>
    </div>`,
  });
}
