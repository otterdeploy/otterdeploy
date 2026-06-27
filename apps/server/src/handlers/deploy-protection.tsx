/**
 * Deployment protection — the cross-domain auth wall (Vercel-Authentication
 * style). Four routes, hit on two different kinds of host:
 *
 *  - GET /api/internal/deploy-authz   (forward_auth target, internal)
 *      Per-request gate. Allows on: a valid __otter_auth session cookie, a
 *      valid __otter_share cookie, or a valid x-otter-bypass automation
 *      header. Otherwise 302s to /authorize on the central auth authority.
 *      Pure HMAC checks — no DB hit on the hot path.
 *
 *  - GET /.well-known/otterdeploy/authorize   (on the auth authority)
 *      Reads the master Better-Auth session, checks org membership of the
 *      deployment owner, mints a short-lived handoff token, and serves the
 *      "Authenticating…" interstitial that bounces to the callback.
 *
 *  - GET /.well-known/otterdeploy/callback     (on the deployment domain)
 *      Verifies the handoff token and Set-Cookies the host-only
 *      __otter_auth session cookie, then redirects to the original path.
 *
 *  - GET /.well-known/otterdeploy/share        (on the deployment domain)
 *      Exchanges a shareable-link token for a __otter_share cookie.
 *
 * The wall pages are Hono JSX components (see the bottom of this file); text
 * and attributes are auto-escaped, so untrusted values (domain, return path)
 * interpolate safely. <style>/<script> bodies are injected raw — JSX would
 * mangle the `&&`/`::before` in them.
 *
 * See docs/designs/deployment-protection.md §4, §7, §8, §9.
 */

import type { Context, Handler } from "hono";
import type { FC, PropsWithChildren } from "hono/jsx";
import type { ContentfulStatusCode } from "hono/utils/http-status";

import { guestSessionHoursFor } from "@otterdeploy/api/authz/guests";
import { isOrgMember, resolveProtectedDomainOrg } from "@otterdeploy/api/authz/membership";
import { claimHandoffNonce } from "@otterdeploy/api/authz/nonce";
import { consumeOtp, generateOtp, storeOtp, underRateLimit } from "@otterdeploy/api/authz/otp";
import {
  signGuestCookie,
  signHandoffToken,
  signSessionCookie,
  verifyGrantToken,
  verifyGuestCookie,
  verifyHandoffToken,
  verifySessionCookie,
} from "@otterdeploy/api/authz/tokens";
import { auth } from "@otterdeploy/auth";
import { sendEmail } from "@otterdeploy/email";
import { env } from "@otterdeploy/env/server";
import { Result } from "better-result";
import { log } from "evlog";
import { getCookie, setCookie } from "hono/cookie";
import { raw } from "hono/html";

const SESSION_COOKIE = "__otter_auth";
const GUEST_COOKIE = "__otter_guest";
const SHARE_COOKIE = "__otter_share";
const BYPASS_HEADER = "x-otter-bypass";

const SESSION_COOKIE_MAX_AGE = 60 * 60; // 1h — matches the session token TTL
const GUEST_COOKIE_MAX_AGE = 30 * 24 * 60 * 60; // bounded; real expiry is the token's own exp
const SHARE_COOKIE_MAX_AGE = 7 * 24 * 60 * 60; // bounded; real expiry is the token's own exp

/** Web app base, for the login redirect. The auth *authority* (getSession)
 *  is BETTER_AUTH_URL; the login UI is the web app. */
const WEB_BASE = env.PUBLIC_WEB_URL ?? env.CORS_ORIGIN[0] ?? env.BETTER_AUTH_URL;

/** Render a branded error page for a known, browser-facing failure (bad/expired
 *  link, unknown deployment). Never leaks internals — title/detail are fixed
 *  copy. Used in place of the old raw `c.text("…")` returns. */
const errorPage = (
  c: Context,
  status: ContentfulStatusCode,
  title: string,
  detail: string,
): Response | Promise<Response> =>
  c.html(<ErrorPage status={status} title={title} detail={detail} />, status);

/** Boundary wrapper for the public wall routes. Any *thrown* error (e.g. a DB
 *  failure deep in resolveProtectedDomainOrg) is caught here and turned into a
 *  caller-controlled fallback, so a raw stack/SQL never reaches a visitor via
 *  the global JSON onError. Result-based, per the codebase's no-try/catch rule. */
const guard =
  (handler: Handler, fallback: (c: Context) => Response | Promise<Response>): Handler =>
  async (c, next) =>
    (
      await Result.tryPromise({
        try: async () => handler(c, next),
        catch: (e) => e,
      })
    ).match({
      ok: (res) => res,
      err: (cause) => {
        c.get("log").error(cause);
        return fallback(c);
      },
    });

/** The 500 fallback for HTML wall routes — a branded "something went wrong". */
const serverError = (c: Context): Response | Promise<Response> =>
  errorPage(
    c,
    500,
    "Something went wrong",
    "We couldn't load this page right now. Please try again in a moment.",
  );

/** The protected deployment a request is trying to authenticate access to. Both
 *  wall routes that gate a deployment carry it in `?domain=` (the authorize
 *  route from its sign-in link, the forward_auth gate from Caddy). Its presence
 *  is the signal that this is a *protected-domain auth request* — as opposed to
 *  an ordinary call — which is exactly the context where a failed session lookup
 *  should send the visitor to sign in rather than surface an error. Returns null
 *  when absent (not a valid auth request). */
const authTargetDomain = (c: Context): string | null => c.req.query("domain") ?? null;

/** forward_auth target. Allow → 200; deny/unauthenticated → non-2xx that
 *  Caddy relays to the browser. */
export const deployAuthzHandler = guard(async (c) => {
  const domain = authTargetDomain(c);
  if (!domain)
    return errorPage(c, 400, "Bad request", "This request is missing required information.");

  const org = await resolveProtectedDomainOrg(domain);
  if (!org) return c.body(null, 200); // unknown / not protection-enabled → allow

  // 1. Automation bypass header (CI). Anonymous → blank identity.
  const bypass = c.req.header(BYPASS_HEADER);
  if (bypass && (await verifyGrantToken(bypass, "bypass", domain))) {
    return allow(c, "", "");
  }

  // 2. Shareable-link cookie. Anonymous → blank identity.
  const share = getCookie(c, SHARE_COOKIE);
  if (share && (await verifyGrantToken(share, "share", domain))) {
    return allow(c, "", "");
  }

  // 3. Member session cookie.
  const cookie = getCookie(c, SESSION_COOKIE);
  const claims = cookie ? await verifySessionCookie(cookie, domain) : null;
  if (claims) {
    return allow(c, claims.userId, claims.email);
  }

  // 4. Guest session cookie (email-OTP, Cloudflare-style). No org user id.
  const guest = getCookie(c, GUEST_COOKIE);
  const guestClaims = guest ? await verifyGuestCookie(guest, domain) : null;
  if (guestClaims) {
    return allow(c, "", guestClaims.email);
  }

  // 5. Unauthenticated → bounce to the access wall (org login OR email code).
  const forwardedUri = c.req.header("x-forwarded-uri") ?? "/";
  const wall = new URL(`https://${domain}/.well-known/otterdeploy/access`);
  wall.searchParams.set("return", sanitizePath(forwardedUri));
  return c.redirect(wall.toString(), 302);
}, serverError);

/** On the auth authority: master-session + membership check → mint handoff
 *  token → interstitial. */
export const deployAuthorizeHandler: Handler = guard(async (c) => {
  const domain = authTargetDomain(c);
  const returnPath = sanitizePath(c.req.query("return"));

  // Dev-only preview: render a wall page in isolation, skipping the
  // session/membership checks and the auto-redirect. e.g.
  //   /.well-known/otterdeploy/authorize?preview=loading
  // Values: loading | denied | wall. Never active in production.
  if (env.NODE_ENV === "development") {
    const preview = c.req.query("preview");
    // Use the real incoming Host so the preview shows the actual domain, not a
    // mock — falls back only if there's somehow no Host header.
    const demoDomain = domain ?? hostOf(c.req.header("host")) ?? "my-app.example.com";
    if (preview === "loading") return c.html(<Interstitial />);
    if (preview === "denied") return c.html(<Denied domain={demoDomain} />);
    if (preview === "wall") {
      // Wire a real authorize URL so the org button actually navigates (same
      // construction as deployAccessHandler), instead of a dead "#".
      const previewAuthorize = new URL("/.well-known/otterdeploy/authorize", env.BETTER_AUTH_URL);
      previewAuthorize.searchParams.set("domain", demoDomain);
      previewAuthorize.searchParams.set("return", returnPath);
      return c.html(
        <AccessWall
          domain={demoDomain}
          returnPath={returnPath}
          orgAuthorizeUrl={previewAuthorize.toString()}
        />,
      );
    }
  }

  if (!domain)
    return errorPage(
      c,
      400,
      "Invalid link",
      "This sign-in link is missing required information. Try opening the protected site again.",
    );

  const org = await resolveProtectedDomainOrg(domain);
  if (!org)
    return errorPage(
      c,
      404,
      "Deployment not found",
      "This deployment doesn't exist or is no longer protected.",
    );

  // getSession can throw (a transient session/DB error surfaces as Better Auth's
  // "Failed to get session"). Never leak that as raw JSON — treat a failed lookup
  // exactly like "not signed in" and send the visitor to the login page, only
  // flagging the error so the form can hint at it.
  let sessionFailed = false;
  const session = await Result.tryPromise({
    try: () => auth.api.getSession({ headers: c.req.raw.headers }),
    catch: (cause) => cause,
  }).then((r) =>
    r.match({
      ok: (s) => s,
      err: (cause) => {
        sessionFailed = true;
        log.error({
          deployProtection: { event: "session-failed", domain },
          error: cause instanceof Error ? cause.message : String(cause),
        });
        return null;
      },
    }),
  );
  if (!session) {
    // No master session → log in first, then come back to this authorize URL.
    // Rebuild the *public* authorize URL from BETTER_AUTH_URL: behind a proxy
    // (portless/Swarm) c.req.url is the internal address, which the browser
    // can't reach after login — so the return-trip would break.
    const self = new URL("/.well-known/otterdeploy/authorize", env.BETTER_AUTH_URL);
    self.searchParams.set("domain", domain);
    self.searchParams.set("return", returnPath);
    const login = new URL("/sign-in", WEB_BASE);
    login.searchParams.set("redirect", self.toString());
    if (sessionFailed) login.searchParams.set("error", "session_expired");
    return c.redirect(login.toString(), 302);
  }

  if (!(await isOrgMember(session.user.id, org.orgId))) {
    log.info({
      deployProtection: { event: "denied", domain, userId: session.user.id },
    });
    return c.html(<Denied domain={domain} />, 403);
  }

  const token = await signHandoffToken({
    userId: session.user.id,
    orgId: org.orgId,
    email: session.user.email,
    domain,
    return: returnPath,
    nonce: crypto.randomUUID(),
  });

  const callback = new URL(`https://${domain}/.well-known/otterdeploy/callback`);
  callback.searchParams.set("token", token);
  return c.html(<Interstitial next={callback.toString()} />);
}, serverError);

/** On the deployment domain: verify handoff → set host-only session cookie. */
export const deployCallbackHandler: Handler = guard(async (c) => {
  const host = hostOf(c.req.header("host"));
  const token = c.req.query("token");
  if (!host || !token)
    return errorPage(c, 400, "Bad request", "This request is missing required information.");

  const claims = await verifyHandoffToken(token, host);
  if (!claims)
    return errorPage(
      c,
      400,
      "Link expired",
      "This sign-in link is invalid or has expired. Try opening the protected site again.",
    );

  // Single-use: burn the nonce so a captured callback URL can't be replayed
  // within the token's 60s TTL to mint a second session cookie.
  if (!(await claimHandoffNonce(claims.nonce))) {
    return errorPage(
      c,
      400,
      "Link already used",
      "This sign-in link has already been used. Try opening the protected site again.",
    );
  }

  setCookie(
    c,
    SESSION_COOKIE,
    await signSessionCookie({
      userId: claims.userId,
      orgId: claims.orgId,
      email: claims.email,
      domain: host,
    }),
    cookieOptions(SESSION_COOKIE_MAX_AGE),
  );
  return c.redirect(sanitizePath(claims.return), 302);
}, serverError);

/** On the deployment domain: exchange a shareable-link token for a cookie. */
export const deployShareHandler: Handler = guard(async (c) => {
  const host = hostOf(c.req.header("host"));
  const token = c.req.query("token");
  const returnPath = sanitizePath(c.req.query("return"));
  if (!host || !token)
    return errorPage(c, 400, "Bad request", "This request is missing required information.");

  if (!(await verifyGrantToken(token, "share", host))) {
    return errorPage(
      c,
      400,
      "Share link expired",
      "This share link is invalid or has expired. Ask whoever shared it for a new one.",
    );
  }

  // Store the (already signed, domain-bound, self-expiring) token verbatim.
  setCookie(c, SHARE_COOKIE, token, cookieOptions(SHARE_COOKIE_MAX_AGE));
  return c.redirect(returnPath, 302);
}, serverError);

// ─── Guest access (Cloudflare-style email one-time PIN) ───────────────────

/** On the deployment domain: the wall page — org login OR email-code entry. */
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
    <AccessWall domain={host} returnPath={returnPath} orgAuthorizeUrl={authorize.toString()} />,
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

// ─── helpers ───────────────────────────────────────────────────────────

function cookieOptions(maxAge: number) {
  // No `domain` ⇒ host-only, scoped to the deployment domain. sameSite Lax
  // (not Strict) so the cookie is sent on the top-level navigation that
  // arrives from the auth authority.
  return {
    httpOnly: true,
    secure: true,
    sameSite: "Lax" as const,
    path: "/",
    maxAge,
  };
}

/** Allow a request through the forward_auth gate, ALWAYS pinning both identity
 *  headers. Caddy's copy_headers only overwrites what we set here; emitting
 *  both on every allow path (blank when anonymous) — paired with the inbound
 *  `request_header -Remote-*` strip in the Caddyfile — guarantees a
 *  client-supplied header can never reach the backend and spoof identity. */
function allow(c: Context, userId: string, email: string): Response {
  c.header("Remote-User", userId);
  c.header("Remote-Email", email);
  return c.body(null, 200);
}

/** Strip a port and lowercase — the cookie must be scoped to the bare host. */
function hostOf(header: string | undefined): string | null {
  if (!header) return null;
  return header.split(":")[0]!.toLowerCase() || null;
}

/** Only allow same-origin absolute paths — reject schemes and protocol-
 *  relative `//evil.com` to prevent open redirects. The second-char `\\`
 *  check matters too: browsers fold `\` to `/`, so `/\evil.com` would
 *  resolve as protocol-relative `//evil.com`. */
function sanitizePath(input: string | undefined): string {
  if (!input || input[0] !== "/" || input[1] === "/" || input[1] === "\\") {
    return "/";
  }
  return input;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Shared document shell: a black, centered, full-height page with the
 *  branded footer. `css`/`headExtra` are page-specific; Hono JSX won't add a
 *  doctype, so we prepend one raw. */
const Page: FC<
  PropsWithChildren<{
    title: string;
    css: string;
    headExtra?: unknown;
    /** Suppress the default "Otterdeploy Authentication" footer — for pages
     *  (e.g. ErrorPage) that render their own. */
    hideFoot?: boolean;
  }>
> = ({ title, css, headExtra, hideFoot, children }) => (
  <>
    {raw("<!doctype html>")}
    <html>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        {headExtra}
        <title>{title}</title>
        <style dangerouslySetInnerHTML={{ __html: css }} />
      </head>
      <body>
        {children}
        {hideFoot ? undefined : <div class="foot">Otterdeploy Authentication</div>}
      </body>
    </html>
  </>
);

/** Shared console-frame styling for the wall's full-screen status pages
 *  (ErrorPage + Interstitial). The web `ErrorScreen` aesthetic ported to
 *  server HTML — dark, masked grid, accent glow, grain, corner-tick frame.
 *  Caller passes the accent/glow and appends page-specific rules. */
const consoleFrameCss = (accent: string, glow: string): string => `
  :root {
    --bg: #0a0b0d;
    --ink: #e7e8ec;
    --dim: #8b8d95;
    --line: rgba(231, 232, 236, 0.07);
    --line2: rgba(231, 232, 236, 0.16);
    --accent: ${accent};
    --glow: ${glow};
  }
  * {
    box-sizing: border-box;
  }
  html,
  body {
    height: 100%;
    margin: 0;
  }
  body {
    position: relative;
    overflow: hidden;
    background: var(--bg);
    color: var(--ink);
    font-family: ui-monospace, SFMono-Regular, Menlo, "Geist Mono Variable",
      monospace;
    font-size: clamp(13px, 1.4vmin, 17px);
    -webkit-font-smoothing: antialiased;
  }
  .layer {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }
  .grid {
    z-index: 0;
    background-image:
      linear-gradient(var(--line) 1px, transparent 1px),
      linear-gradient(90deg, var(--line) 1px, transparent 1px);
    background-size: 72px 72px;
    -webkit-mask-image: radial-gradient(
      ellipse 72% 72% at 50% 50%,
      #000 32%,
      transparent 90%
    );
    mask-image: radial-gradient(
      ellipse 72% 72% at 50% 50%,
      #000 32%,
      transparent 90%
    );
  }
  .glow {
    z-index: 0;
    background: radial-gradient(
      36rem 26rem at 50% 48%,
      var(--glow),
      transparent 72%
    );
  }
  .grain {
    z-index: 1;
    opacity: 0.04;
    background-image: url("data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20width='160'%20height='160'%3E%3Cfilter%20id='n'%3E%3CfeTurbulence%20type='fractalNoise'%20baseFrequency='0.82'%20numOctaves='2'%20stitchTiles='stitch'/%3E%3C/filter%3E%3Crect%20width='100%25'%20height='100%25'%20filter='url(%23n)'/%3E%3C/svg%3E");
  }
  .tick {
    position: absolute;
    z-index: 3;
    width: 14px;
    height: 14px;
  }
  .tick.tl {
    top: 14px;
    left: 14px;
    border-top: 1px solid var(--line2);
    border-left: 1px solid var(--line2);
  }
  .tick.tr {
    top: 14px;
    right: 14px;
    border-top: 1px solid var(--line2);
    border-right: 1px solid var(--line2);
  }
  .tick.bl {
    bottom: 14px;
    left: 14px;
    border-bottom: 1px solid var(--line2);
    border-left: 1px solid var(--line2);
  }
  .tick.br {
    bottom: 14px;
    right: 14px;
    border-bottom: 1px solid var(--line2);
    border-right: 1px solid var(--line2);
  }
  .bar {
    position: absolute;
    inset-inline: 0;
    z-index: 3;
    display: flex;
    justify-content: space-between;
    padding: 24px 32px;
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.16em;
    color: var(--dim);
  }
  .bar.top {
    top: 0;
  }
  .bar.bottom {
    bottom: 0;
  }
  .bar b {
    font-weight: 400;
    color: var(--ink);
  }
  .accent {
    color: var(--accent);
  }
  main {
    position: relative;
    z-index: 2;
    display: flex;
    min-height: 100%;
    align-items: center;
    justify-content: center;
    padding: 11vh 8vw;
  }
  .panel {
    width: 100%;
    max-width: 600px;
    text-align: center;
  }
  .eyebrow {
    margin-bottom: 1.7rem;
    font-size: 0.74rem;
    text-transform: uppercase;
    letter-spacing: 0.26em;
    color: var(--accent);
  }
  h1 {
    margin: 1.4rem 0 0;
    font-weight: 700;
    text-transform: uppercase;
    line-height: 1.1;
    letter-spacing: -0.01em;
    font-size: clamp(1.3rem, 2.7vw, 2.05rem);
  }
  .msg {
    margin: 1rem auto 0;
    max-width: 46ch;
    line-height: 1.65;
    color: var(--dim);
    font-size: clamp(0.88rem, 1.15vw, 1.02rem);
  }
  .rise {
    animation: rise 0.6s cubic-bezier(0.2, 0.7, 0.2, 1) both;
  }
  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(16px);
    }
    to {
      opacity: 1;
      transform: none;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .rise {
      animation: none;
    }
  }
`;

/** The shared frame chrome: background layers, corner ticks, and the top/bottom
 *  status bars. `barRight` fills the top-right slot (e.g. "ERR / 500",
 *  "AUTH / SSO"); `statusTag` is the accent word in the footer STATUS line.
 *  Children render inside the centered <main> panel. */
const ConsoleFrame: FC<PropsWithChildren<{ barRight: unknown; statusTag: string }>> = ({
  barRight,
  statusTag,
  children,
}) => (
  <>
    <div class="layer grid" aria-hidden="true" />
    <div class="layer glow" aria-hidden="true" />
    <div class="layer grain" aria-hidden="true" />
    <span class="tick tl" aria-hidden="true" />
    <span class="tick tr" aria-hidden="true" />
    <span class="tick bl" aria-hidden="true" />
    <span class="tick br" aria-hidden="true" />

    <div class="bar top">
      <span>
        <span class="accent">◆</span> OTTERDEPLOY
      </span>
      <span>{barRight}</span>
    </div>

    <main>
      <div class="panel">{children}</div>
    </main>

    <div class="bar bottom">
      <span>
        STATUS: <span class="accent">{statusTag}</span>
      </span>
      <span>OTTERDEPLOY PLATFORM</span>
    </div>
  </>
);

/** The "Authenticating…" handoff screen — the shared console frame with a
 *  spinner, an indigo accent, and a live status line. Navigates to `next`
 *  immediately (meta-refresh + location.replace + noscript fallback); with no
 *  `next` (dev preview) it stays put and cycles the status steps. */
const Interstitial: FC<{ next?: string }> = ({ next }) => (
  <Page
    title="Otterdeploy — Authenticating"
    hideFoot
    headExtra={next ? <meta http-equiv="refresh" content={`0;url=${next}`} /> : undefined}
    css={
      consoleFrameCss("oklch(0.7 0.18 300)", "oklch(0.7 0.18 300 / 0.26)") +
      `
        .spinner {
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--accent);
        }
        .spinner svg {
          width: 52px;
          height: 52px;
          animation: spin 1s linear infinite;
          filter: drop-shadow(0 0 28px var(--glow));
        }
        @keyframes spin {
          to {
            transform: rotate(360deg);
          }
        }
        .statusline {
          display: inline-flex;
          align-items: center;
          margin: 1.4rem auto 0;
          min-height: 1.4em;
          color: var(--dim);
          font-size: 0.82rem;
          letter-spacing: 0.04em;
        }
        .cursor {
          display: inline-block;
          width: 7px;
          height: 1.05em;
          margin-left: 4px;
          background: var(--accent);
          vertical-align: text-bottom;
          opacity: 0.75;
          animation: blink 0.85s step-end infinite;
        }
        @keyframes blink {
          0%,
          100% {
            opacity: 0.75;
          }
          50% {
            opacity: 0;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .spinner svg,
          .cursor {
            animation: none;
          }
        }
      `
    }
  >
    <ConsoleFrame
      barRight={
        <>
          AUTH / <b>SSO</b>
        </>
      }
      statusTag="VERIFYING"
    >
      <div class="eyebrow rise" style="animation-delay:0.1s">
        Authenticating
      </div>
      <div class="spinner rise" style="animation-delay:0.19s">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M12 2v4" />
          <path d="m16.2 7.8 2.9-2.9" />
          <path d="M18 12h4" />
          <path d="m16.2 16.2 2.9 2.9" />
          <path d="M12 18v4" />
          <path d="m4.9 19.1 2.9-2.9" />
          <path d="M2 12h4" />
          <path d="m4.9 4.9 2.9 2.9" />
        </svg>
      </div>
      <h1 class="rise" style="animation-delay:0.28s">
        Securing your session
      </h1>
      <p class="statusline rise" style="animation-delay:0.37s" id="authLabel">
        verifying identity
        <span class="cursor" />
      </p>
    </ConsoleFrame>

    {next ? (
      <>
        <noscript>
          <a href={next} style="color:var(--ink)">
            Continue
          </a>
        </noscript>
        <script
          dangerouslySetInnerHTML={{
            __html: `location.replace(${JSON.stringify(next)})`,
          }}
        />
      </>
    ) : (
      <script
        dangerouslySetInnerHTML={{
          __html: `(function(){var s=["verifying identity","fetching workspace","checking permissions","loading environment"],i=0,el=document.getElementById("authLabel");setInterval(function(){i=(i+1)%s.length;el.innerHTML=s[i]+'<span class="cursor"></span>';},2400);})();`,
        }}
      />
    )}
  </Page>
);

const Denied: FC<{ domain: string }> = ({ domain }) => (
  <Page
    title="No access"
    css={`
      html,
      body {
        height: 100%;
        margin: 0;
        background: #000;
        color: #fff;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      .wrap {
        height: 100%;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 12px;
        text-align: center;
        padding: 0 24px;
      }
      h1 {
        font-size: 24px;
        font-weight: 600;
        margin: 0;
      }
      p {
        color: #999;
        margin: 0;
        max-width: 420px;
      }
      .foot {
        position: fixed;
        bottom: 28px;
        color: #666;
        font-size: 13px;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      }
    `}
  >
    <div class="wrap">
      <h1>You don't have access</h1>
      <p>
        This deployment ({domain}) is protected. Ask an organization owner to add you, or switch to
        an account that's a member.
      </p>
    </div>
  </Page>
);

/** Branded failure page for the wall routes — bad/expired link, unknown
 *  deployment, or an unexpected 500. Uses the shared console frame (same
 *  grid/glow/grain + corner-tick chrome as the web `ErrorScreen`). `title`/
 *  `detail` are fixed, caller-chosen copy: no error object, stack, or SQL ever
 *  reaches the page. */
const ErrorPage: FC<{ status: number; title: string; detail: string }> = ({
  status,
  title,
  detail,
}) => {
  // 5xx = red (our fault), 4xx = indigo (request/link) — mirrors the web pages.
  const isServer = status >= 500;
  const accent = isServer ? "oklch(0.685 0.205 25)" : "oklch(0.7 0.17 264)";
  const glow = isServer ? "oklch(0.685 0.205 25 / 0.26)" : "oklch(0.7 0.17 264 / 0.26)";
  const eyebrow = isServer ? "Internal error" : "Request blocked";
  const statusTag = isServer ? "FAULT" : "BLOCKED";

  return (
    <Page
      title={title}
      hideFoot
      css={
        consoleFrameCss(accent, glow) +
        `
        .numeral {
          font-weight: 700;
          line-height: 1;
          letter-spacing: -0.04em;
          color: var(--accent);
          font-size: clamp(3.2rem, 9vw, 6rem);
          text-shadow: 0 0 52px var(--glow);
        }
      `
      }
    >
      <ConsoleFrame
        barRight={
          <>
            ERR / <b>{String(status)}</b>
          </>
        }
        statusTag={statusTag}
      >
        <div class="eyebrow rise" style="animation-delay:0.1s">
          {eyebrow}
        </div>
        <div class="numeral rise" style="animation-delay:0.19s">
          {String(status)}
        </div>
        <h1 class="rise" style="animation-delay:0.28s">
          {title}
        </h1>
        <p class="msg rise" style="animation-delay:0.37s">
          {detail}
        </p>
      </ConsoleFrame>
    </Page>
  );
};

/** The wall: org sign-in OR email one-time-code entry (Cloudflare-style).
 *  Split-panel layout — brand/context on the left, the auth actions on the
 *  right. Two-step form (email → code) handled inline; posts to the OTP
 *  endpoints on this same domain and navigates to `returnPath` on success.
 *  Icons are inline SVG (no external icon CDN); accent is purple. */
const AccessWall: FC<{
  domain: string;
  returnPath: string;
  orgAuthorizeUrl: string;
}> = ({ domain, returnPath, orgAuthorizeUrl }) => (
  <Page
    title="Otterdeploy — Sign in"
    hideFoot
    css={`
      * {
        box-sizing: border-box;
      }
      :root {
        --bg: #0c0c0b;
        --fg: #f5f5f0;
        --fg-muted: #7a7a72;
        --fg-subtle: #3a3a36;
        --border: rgba(255, 255, 250, 0.08);
        --border-mid: rgba(255, 255, 250, 0.13);
        --primary: oklch(0.623 0.214 300);
        --primary-dim: oklch(0.623 0.214 300 / 0.15);
        --line: rgba(255, 255, 250, 0.04);
        --radius: 10px;
        --input-bg: rgba(255, 255, 250, 0.05);
      }
      html,
      body {
        height: 100%;
        margin: 0;
        overscroll-behavior: none;
      }
      body {
        font-family: "Geist Variable", ui-sans-serif, system-ui, sans-serif;
        font-size: 14px;
        letter-spacing: -0.005em;
        -webkit-font-smoothing: antialiased;
        background: var(--bg);
        color: var(--fg);
        height: 100vh;
        overflow: hidden;
        display: flex;
      }
      .layout {
        display: flex;
        width: 100%;
        height: 100vh;
      }
      .left {
        flex: 1;
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        gap: 48px;
        padding: 56px 64px 72px;
        position: relative;
        border-right: 1px solid var(--border);
        overflow: hidden;
      }
      .left-grid {
        position: absolute;
        inset: 0;
        pointer-events: none;
        background-image:
          linear-gradient(var(--line) 1px, transparent 1px),
          linear-gradient(90deg, var(--line) 1px, transparent 1px);
        background-size: 64px 64px;
      }
      .left-glow {
        position: absolute;
        inset: 0;
        pointer-events: none;
        background: radial-gradient(
          60rem 50rem at 20% 60%,
          oklch(0.623 0.214 300 / 0.08),
          transparent 65%
        );
      }
      .left-top,
      .left-middle {
        position: relative;
      }
      .wordmark {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .wordmark svg {
        width: 20px;
        height: 20px;
        color: var(--primary);
      }
      .wordmark-name {
        font-size: 13px;
        font-weight: 600;
        letter-spacing: -0.02em;
        color: var(--fg);
      }
      .left-eyebrow {
        font-family: "Geist Mono Variable", ui-monospace, monospace;
        font-size: 10px;
        letter-spacing: 0.1em;
        color: var(--fg-muted);
        text-transform: uppercase;
        margin-bottom: 24px;
      }
      .left-headline {
        font-size: 30px;
        font-weight: 600;
        letter-spacing: -0.04em;
        line-height: 1.3;
        color: var(--fg);
        margin-bottom: 36px;
      }
      .left-headline em {
        font-style: normal;
        color: var(--fg-muted);
        font-weight: 400;
      }
      .domain-label {
        font-family: "Geist Mono Variable", ui-monospace, monospace;
        font-size: 10px;
        color: var(--fg-muted);
        letter-spacing: 0.06em;
        text-transform: uppercase;
        margin-bottom: 6px;
      }
      .domain-pill {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 8px 12px;
        background: var(--input-bg);
        border: 1px solid var(--border-mid);
        border-radius: 8px;
        font-family: "Geist Mono Variable", ui-monospace, monospace;
        font-size: 12px;
        color: var(--fg);
        font-feature-settings: "zero", "ss03";
      }
      .domain-pill svg {
        width: 15px;
        height: 15px;
        color: var(--primary);
        flex-shrink: 0;
      }
      .domain-cursor {
        display: inline-block;
        width: 1.5px;
        height: 12px;
        background: var(--primary);
        margin-left: 1px;
        vertical-align: middle;
        animation: blink 0.9s step-end infinite;
      }
      @keyframes blink {
        0%,
        100% {
          opacity: 1;
        }
        50% {
          opacity: 0;
        }
      }
      .right {
        width: 420px;
        flex-shrink: 0;
        display: flex;
        flex-direction: column;
        justify-content: center;
        padding: 60px 48px 96px;
        overflow-y: auto;
        animation: rise 0.5s cubic-bezier(0.2, 0.7, 0.2, 1) both;
      }
      @keyframes rise {
        from {
          opacity: 0;
          transform: translateY(10px);
        }
        to {
          opacity: 1;
          transform: none;
        }
      }
      .form-head {
        margin-bottom: 32px;
      }
      .form-title {
        font-size: 20px;
        font-weight: 600;
        letter-spacing: -0.03em;
        color: var(--fg);
        margin-bottom: 6px;
      }
      .form-sub {
        font-size: 13px;
        color: var(--fg-muted);
        letter-spacing: -0.01em;
      }
      .btn-org {
        width: 100%;
        padding: 11px 16px;
        border-radius: var(--radius);
        border: 1px solid var(--border-mid);
        background: var(--input-bg);
        color: var(--fg);
        font-family: inherit;
        font-size: 13px;
        font-weight: 500;
        letter-spacing: -0.01em;
        cursor: pointer;
        text-decoration: none;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 9px;
        transition:
          background 0.12s,
          border-color 0.12s;
        margin-bottom: 20px;
      }
      .btn-org:hover {
        background: rgba(255, 255, 250, 0.09);
        border-color: rgba(255, 255, 250, 0.2);
      }
      .btn-org svg {
        width: 18px;
        height: 18px;
        color: var(--fg-muted);
      }
      .or-row {
        display: flex;
        align-items: center;
        gap: 12px;
        margin-bottom: 20px;
      }
      .or-line {
        flex: 1;
        height: 1px;
        background: var(--border);
      }
      .or-text {
        font-family: "Geist Mono Variable", ui-monospace, monospace;
        font-size: 10px;
        letter-spacing: 0.1em;
        color: var(--fg-muted);
        text-transform: uppercase;
      }
      .field-label {
        display: block;
        font-size: 11px;
        font-weight: 500;
        color: var(--fg-muted);
        letter-spacing: 0.04em;
        margin-bottom: 6px;
        text-transform: uppercase;
        font-family: "Geist Mono Variable", ui-monospace, monospace;
      }
      .email-input {
        width: 100%;
        padding: 11px 14px;
        border-radius: var(--radius);
        border: 1px solid var(--border-mid);
        background: var(--input-bg);
        color: var(--fg);
        font-family: inherit;
        font-size: 13px;
        letter-spacing: -0.01em;
        outline: none;
        transition:
          border-color 0.15s,
          background 0.15s;
        margin-bottom: 8px;
      }
      .email-input::placeholder {
        color: var(--fg-subtle);
      }
      .email-input:focus {
        border-color: var(--primary);
        background: var(--primary-dim);
      }
      .btn-primary {
        width: 100%;
        padding: 11px 16px;
        border-radius: var(--radius);
        border: none;
        background: var(--fg);
        color: var(--bg);
        font-family: inherit;
        font-size: 13px;
        font-weight: 600;
        letter-spacing: -0.01em;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        transition: opacity 0.12s;
      }
      .btn-primary:hover {
        opacity: 0.88;
      }
      .btn-primary:active {
        opacity: 0.75;
        transform: scale(0.99);
      }
      .btn-primary svg {
        width: 16px;
        height: 16px;
      }
      .msg {
        font-size: 12px;
        min-height: 16px;
        margin-top: 12px;
      }
      .msg.err {
        color: #f87171;
      }
      .msg.ok {
        color: #4ade80;
      }
      .hide {
        display: none;
      }
      .form-footer {
        margin-top: 24px;
        font-size: 11px;
        color: var(--fg-subtle);
        line-height: 1.6;
      }
      .form-footer a {
        color: var(--fg-muted);
        text-decoration: none;
        border-bottom: 1px solid var(--border-mid);
        padding-bottom: 1px;
        transition: color 0.12s;
      }
      .form-footer a:hover {
        color: var(--fg);
      }
      .page-footer {
        position: fixed;
        bottom: 0;
        left: 0;
        right: 0;
        border-top: 1px solid var(--border);
        padding: 16px 64px;
        display: flex;
        justify-content: space-between;
        align-items: center;
        background: var(--bg);
        font-family: "Geist Mono Variable", ui-monospace, monospace;
        font-size: 0.72rem;
        text-transform: uppercase;
        letter-spacing: 0.16em;
        color: var(--fg-muted);
      }
      .pf-accent {
        color: var(--primary);
      }
      @media (prefers-reduced-motion: reduce) {
        .right,
        .domain-cursor {
          animation: none;
        }
      }
      @media (max-width: 700px) {
        .left {
          display: none;
        }
        .right {
          width: 100%;
          padding: 48px 28px;
        }
      }
    `}
  >
    <div class="layout">
      <div class="left">
        <div class="left-grid" aria-hidden="true" />
        <div class="left-glow" aria-hidden="true" />

        <div class="left-top">
          <div class="wordmark">
            <svg viewBox="0 0 22 22" fill="none" aria-hidden="true">
              <ellipse
                cx="11"
                cy="13"
                rx="7.5"
                ry="5.5"
                stroke="currentColor"
                stroke-width="1.25"
              />
              <circle cx="7.5" cy="9.5" r="2.8" stroke="currentColor" stroke-width="1.25" />
              <circle cx="14.5" cy="9.5" r="2.8" stroke="currentColor" stroke-width="1.25" />
              <circle cx="7.5" cy="9.5" r="1" fill="currentColor" />
              <circle cx="14.5" cy="9.5" r="1" fill="currentColor" />
              <ellipse cx="11" cy="8" rx="3" ry="2.2" stroke="currentColor" stroke-width="1.25" />
              <path
                d="M3.5 14.5 Q2 16.5 3.5 18"
                stroke="currentColor"
                stroke-width="1.25"
                stroke-linecap="round"
              />
              <path
                d="M18.5 14.5 Q20 16.5 18.5 18"
                stroke="currentColor"
                stroke-width="1.25"
                stroke-linecap="round"
              />
            </svg>
            <span class="wordmark-name">otterdeploy</span>
          </div>
        </div>

        <div class="left-middle">
          <div class="left-eyebrow">Access request</div>
          <div class="left-headline">
            This resource
            <br />
            <em>requires</em> sign-in.
          </div>
          <div class="domain-label">Protected origin</div>
          <div class="domain-pill">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
            </svg>
            {domain}
            <span class="domain-cursor" />
          </div>
        </div>

        <div />
      </div>

      <div class="right">
        <div class="form-head">
          <div class="form-title">Sign in to continue</div>
          <div class="form-sub">Choose how you'd like to authenticate.</div>
        </div>

        <a class="btn-org" href={orgAuthorizeUrl}>
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <rect width="16" height="20" x="4" y="2" rx="2" />
            <path d="M9 22v-4h6v4" />
            <path d="M8 6h.01" />
            <path d="M16 6h.01" />
            <path d="M12 6h.01" />
            <path d="M12 10h.01" />
            <path d="M12 14h.01" />
            <path d="M16 10h.01" />
            <path d="M16 14h.01" />
            <path d="M8 10h.01" />
            <path d="M8 14h.01" />
          </svg>
          Continue with your organization
        </a>

        <div class="or-row">
          <div class="or-line" />
          <span class="or-text">or</span>
          <div class="or-line" />
        </div>

        <form id="emailForm">
          <label class="field-label" for="email">
            Work email
          </label>
          <input
            class="email-input"
            id="email"
            type="email"
            placeholder="you@example.com"
            autocomplete="email"
            required
          />
          <button class="btn-primary" type="submit">
            Email me a code
          </button>
        </form>

        <form id="codeForm" class="hide">
          <label class="field-label" for="code">
            Verification code
          </label>
          <input
            class="email-input"
            id="code"
            inputmode="numeric"
            pattern="[0-9]*"
            maxlength={6}
            placeholder="6-digit code"
            autocomplete="one-time-code"
          />
          <button class="btn-primary" type="submit">
            Verify
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path d="M5 12h14" />
              <path d="m12 5 7 7-7 7" />
            </svg>
          </button>
        </form>

        <div id="msg" class="msg" />

        <div class="form-footer">
          Don't have access? Contact the site's administrator or developer to request an invite.
        </div>
      </div>
    </div>

    <div class="page-footer">
      <span>
        STATUS: <span class="pf-accent">AWAITING SIGN-IN</span>
      </span>
      <span>OTTERDEPLOY PLATFORM</span>
    </div>

    <script
      dangerouslySetInnerHTML={{
        __html: `
  var RETURN=${JSON.stringify(returnPath)};
  var emailForm=document.getElementById('emailForm'),codeForm=document.getElementById('codeForm'),
      msg=document.getElementById('msg'),emailEl=document.getElementById('email'),codeEl=document.getElementById('code');
  function set(t,cls){msg.textContent=t;msg.className='msg '+(cls||'');}
  emailForm.addEventListener('submit',async function(e){
    e.preventDefault();set('Sending…');
    await fetch('/.well-known/otterdeploy/otp/request',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({email:emailEl.value})});
    emailForm.classList.add('hide');codeForm.classList.remove('hide');codeEl.focus();
    set('If '+emailEl.value+' is invited, a code is on its way.','ok');
  });
  codeForm.addEventListener('submit',async function(e){
    e.preventDefault();set('Verifying…');
    var r=await fetch('/.well-known/otterdeploy/otp/verify',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({email:emailEl.value,code:codeEl.value,return:RETURN})});
    var d=await r.json().catch(function(){return {};});
    if(r.ok&&d.ok){location.replace(d.redirect||RETURN);}else{set(d.error||'Invalid or expired code','err');}
  });`,
      }}
    />
  </Page>
);
