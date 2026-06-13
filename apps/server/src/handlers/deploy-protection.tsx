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

import {
  isOrgMember,
  resolveProtectedDomainOrg,
} from "@otterdeploy/api/authz/membership";
import { guestSessionHoursFor } from "@otterdeploy/api/authz/guests";
import { claimHandoffNonce } from "@otterdeploy/api/authz/nonce";
import {
  consumeOtp,
  generateOtp,
  storeOtp,
  underRateLimit,
} from "@otterdeploy/api/authz/otp";
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
import type { Context, Handler } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { raw } from "hono/html";
import type { FC, PropsWithChildren } from "hono/jsx";

const SESSION_COOKIE = "__otter_auth";
const GUEST_COOKIE = "__otter_guest";
const SHARE_COOKIE = "__otter_share";
const BYPASS_HEADER = "x-otter-bypass";

const SESSION_COOKIE_MAX_AGE = 60 * 60; // 1h — matches the session token TTL
const GUEST_COOKIE_MAX_AGE = 30 * 24 * 60 * 60; // bounded; real expiry is the token's own exp
const SHARE_COOKIE_MAX_AGE = 7 * 24 * 60 * 60; // bounded; real expiry is the token's own exp

/** Web app base, for the login redirect. The auth *authority* (getSession)
 *  is BETTER_AUTH_URL; the login UI is the web app. */
const WEB_BASE =
  env.PUBLIC_WEB_URL ?? env.CORS_ORIGIN[0] ?? env.BETTER_AUTH_URL;

/** forward_auth target. Allow → 200; deny/unauthenticated → non-2xx that
 *  Caddy relays to the browser. */
export const deployAuthzHandler: Handler = async (c) => {
  const domain = c.req.query("domain");
  if (!domain) return c.text("missing domain", 400);

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
};

/** On the auth authority: master-session + membership check → mint handoff
 *  token → interstitial. */
export const deployAuthorizeHandler: Handler = async (c) => {
  const domain = c.req.query("domain");
  const returnPath = sanitizePath(c.req.query("return"));
  if (!domain) return c.text("missing domain", 400);

  const org = await resolveProtectedDomainOrg(domain);
  if (!org) return c.text("unknown deployment", 404);

  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) {
    // No master session → log in first, then come back to this authorize URL.
    // Rebuild the *public* authorize URL from BETTER_AUTH_URL: behind a proxy
    // (portless/Swarm) c.req.url is the internal address, which the browser
    // can't reach after login — so the return-trip would break.
    const self = new URL(
      "/.well-known/otterdeploy/authorize",
      env.BETTER_AUTH_URL,
    );
    self.searchParams.set("domain", domain);
    self.searchParams.set("return", returnPath);
    const login = new URL("/sign-in", WEB_BASE);
    login.searchParams.set("redirect", self.toString());
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

  const callback = new URL(
    `https://${domain}/.well-known/otterdeploy/callback`,
  );
  callback.searchParams.set("token", token);
  return c.html(<Interstitial next={callback.toString()} />);
};

/** On the deployment domain: verify handoff → set host-only session cookie. */
export const deployCallbackHandler: Handler = async (c) => {
  const host = hostOf(c.req.header("host"));
  const token = c.req.query("token");
  if (!host || !token) return c.text("bad request", 400);

  const claims = await verifyHandoffToken(token, host);
  if (!claims) return c.text("invalid or expired link", 400);

  // Single-use: burn the nonce so a captured callback URL can't be replayed
  // within the token's 60s TTL to mint a second session cookie.
  if (!(await claimHandoffNonce(claims.nonce))) {
    return c.text("this link has already been used", 400);
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
};

/** On the deployment domain: exchange a shareable-link token for a cookie. */
export const deployShareHandler: Handler = async (c) => {
  const host = hostOf(c.req.header("host"));
  const token = c.req.query("token");
  const returnPath = sanitizePath(c.req.query("return"));
  if (!host || !token) return c.text("bad request", 400);

  if (!(await verifyGrantToken(token, "share", host))) {
    return c.text("invalid or expired share link", 400);
  }

  // Store the (already signed, domain-bound, self-expiring) token verbatim.
  setCookie(c, SHARE_COOKIE, token, cookieOptions(SHARE_COOKIE_MAX_AGE));
  return c.redirect(returnPath, 302);
};

// ─── Guest access (Cloudflare-style email one-time PIN) ───────────────────

/** On the deployment domain: the wall page — org login OR email-code entry. */
export const deployAccessHandler: Handler = async (c) => {
  const host = hostOf(c.req.header("host"));
  const returnPath = sanitizePath(c.req.query("return"));
  if (!host) return c.text("bad request", 400);

  const org = await resolveProtectedDomainOrg(host);
  if (!org) return c.text("unknown deployment", 404);

  // "Continue with organization" → the existing master-session handoff.
  const authorize = new URL(
    "/.well-known/otterdeploy/authorize",
    env.BETTER_AUTH_URL,
  );
  authorize.searchParams.set("domain", host);
  authorize.searchParams.set("return", returnPath);

  return c.html(
    <AccessWall
      domain={host}
      returnPath={returnPath}
      orgAuthorizeUrl={authorize.toString()}
    />,
  );
};

/** Request an OTP. Always responds 200 — never reveal whether the email is on
 *  the allow-list (anti-enumeration). Sends a code only to invited guests. */
export const deployOtpRequestHandler: Handler = async (c) => {
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
        ok: () =>
          log.info({ deployProtection: { event: "otp-sent", domain: host } }),
        err: (err) =>
          log.error({
            deployProtection: { event: "otp-send-failed", domain: host },
            error: err instanceof Error ? err.message : String(err),
          }),
      }),
    );
  }
  return c.json({ ok: true });
};

/** Verify an OTP → mint the deployment-scoped guest cookie (TTL = the guest's
 *  configured session length). */
export const deployOtpVerifyHandler: Handler = async (c) => {
  const host = hostOf(c.req.header("host"));
  const body = await c.req.json().catch(() => ({}) as Record<string, unknown>);
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const code = typeof body.code === "string" ? body.code.trim() : "";
  const returnPath = sanitizePath(
    typeof body.return === "string" ? body.return : "/",
  );
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
};

async function sendOtpEmail(
  email: string,
  code: string,
  domain: string,
): Promise<void> {
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
  PropsWithChildren<{ title: string; css: string; headExtra?: unknown }>
> = ({ title, css, headExtra, children }) => (
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
        <div class="foot">Otterdeploy Authentication</div>
      </body>
    </html>
  </>
);

/** The "Authenticating…" screen (Vercel-style). Black, centered, a spinner.
 *  Navigates to `next` immediately; meta-refresh + noscript link are
 *  fallbacks. */
const Interstitial: FC<{ next: string }> = ({ next }) => (
  <Page
    title="Authenticating…"
    headExtra={<meta http-equiv="refresh" content={`0;url=${next}`} />}
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
        gap: 24px;
      }
      .spin {
        width: 22px;
        height: 22px;
        border: 2px solid #333;
        border-top-color: #fff;
        border-radius: 50%;
        animation: s 0.8s linear infinite;
      }
      h1 {
        font-size: 28px;
        font-weight: 600;
        margin: 0;
      }
      .foot {
        position: fixed;
        bottom: 28px;
        color: #666;
        font-size: 13px;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      }
      @keyframes s {
        to {
          transform: rotate(360deg);
        }
      }
    `}
  >
    <div class="wrap">
      <div class="spin"></div>
      <h1>Authenticating</h1>
    </div>
    <noscript>
      <a href={next} style="color:#fff">
        Continue
      </a>
    </noscript>
    <script
      dangerouslySetInnerHTML={{
        __html: `location.replace(${JSON.stringify(next)})`,
      }}
    />
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
        This deployment ({domain}) is protected. Ask an organization owner to
        add you, or switch to an account that's a member.
      </p>
    </div>
  </Page>
);

/** The wall: org sign-in OR email one-time-code entry (Cloudflare-style).
 *  Two-step form (email → code) handled inline; posts to the OTP endpoints
 *  on this same domain and navigates to `returnPath` on success. */
const AccessWall: FC<{
  domain: string;
  returnPath: string;
  orgAuthorizeUrl: string;
}> = ({ domain, returnPath, orgAuthorizeUrl }) => (
  <Page
    title="Sign in"
    css={`
      html,
      body {
        height: 100%;
        margin: 0;
        background: #0c0c0b;
        color: #f5f5f0;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      .wrap {
        height: 100%;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 0 24px;
      }
      .card {
        width: 100%;
        max-width: 360px;
        display: flex;
        flex-direction: column;
        gap: 14px;
      }
      h1 {
        font-size: 20px;
        font-weight: 600;
        margin: 0 0 2px;
      }
      .sub {
        color: #8a8a82;
        font-size: 13px;
        margin: 0 0 8px;
      }
      .dom {
        font-family: ui-monospace, Menlo, monospace;
        color: #cfcfc7;
      }
      a.btn,
      button.btn {
        display: flex;
        align-items: center;
        justify-content: center;
        height: 40px;
        border-radius: 8px;
        border: 1px solid #2a2a26;
        background: #161614;
        color: #f5f5f0;
        font-size: 14px;
        font-weight: 500;
        text-decoration: none;
        cursor: pointer;
        width: 100%;
      }
      button.btn.primary {
        background: #f5f5f0;
        color: #0c0c0b;
        border-color: #f5f5f0;
      }
      input {
        height: 40px;
        border-radius: 8px;
        border: 1px solid #2a2a26;
        background: #0c0c0b;
        color: #f5f5f0;
        padding: 0 12px;
        font-size: 14px;
        width: 100%;
        box-sizing: border-box;
        outline: none;
      }
      input:focus {
        border-color: #555;
      }
      .or {
        display: flex;
        align-items: center;
        gap: 10px;
        color: #666;
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.08em;
      }
      .or::before,
      .or::after {
        content: "";
        flex: 1;
        height: 1px;
        background: #2a2a26;
      }
      .msg {
        font-size: 12px;
        min-height: 16px;
      }
      .msg.err {
        color: #f87171;
      }
      .msg.ok {
        color: #4ade80;
      }
      .foot {
        position: fixed;
        bottom: 24px;
        color: #666;
        font-size: 12px;
        font-family: ui-monospace, Menlo, monospace;
      }
      .hide {
        display: none;
      }
    `}
  >
    <div class="wrap">
      <div class="card">
        <div>
          <h1>Sign in to continue</h1>
          <p class="sub">
            <span class="dom">{domain}</span> is protected.
          </p>
        </div>

        <a class="btn" href={orgAuthorizeUrl}>
          Continue with your organization
        </a>

        <div class="or">or</div>

        <form id="emailForm">
          <input
            id="email"
            type="email"
            placeholder="you@example.com"
            autocomplete="email"
            required
          />
          <button class="btn primary" type="submit" style="margin-top:10px">
            Email me a code
          </button>
        </form>

        <form id="codeForm" class="hide">
          <input
            id="code"
            inputmode="numeric"
            pattern="[0-9]*"
            maxlength={6}
            placeholder="6-digit code"
            autocomplete="one-time-code"
          />
          <button class="btn primary" type="submit" style="margin-top:10px">
            Verify
          </button>
        </form>

        <div id="msg" class="msg"></div>
      </div>
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
