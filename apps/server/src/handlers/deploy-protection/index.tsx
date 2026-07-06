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
 * The guest (email-OTP) routes live in ./guest and are re-exported below;
 * the wall pages live in ./ui/frame and ./ui/wall; shared helpers in ./shared.
 *
 * See docs/designs/deployment-protection.md §4, §7, §8, §9.
 */

import type { Handler } from "hono";

import { isOrgMember, resolveProtectedDomainOrg } from "@otterdeploy/api/authz/membership";
import { claimHandoffNonce } from "@otterdeploy/api/authz/nonce";
import {
  signHandoffToken,
  signSessionCookie,
  verifyGrantToken,
  verifyGuestCookie,
  verifyHandoffToken,
  verifySessionCookie,
} from "@otterdeploy/api/authz/tokens";
import { auth } from "@otterdeploy/auth";
import { env } from "@otterdeploy/env/server";
import { Result } from "better-result";
import { log } from "evlog";
import { getCookie, setCookie } from "hono/cookie";

import {
  allow,
  authTargetDomain,
  BYPASS_HEADER,
  cookieOptions,
  errorPage,
  guard,
  GUEST_COOKIE,
  hostOf,
  sanitizePath,
  serverError,
  SESSION_COOKIE,
  SESSION_COOKIE_MAX_AGE,
  SHARE_COOKIE,
  SHARE_COOKIE_MAX_AGE,
  WEB_BASE,
} from "./shared";
import { pinCookieAllows } from "./pin";
import { Denied, Interstitial } from "./ui/frame";
import { AccessWall } from "./ui/wall";

export { deployAccessHandler, deployOtpRequestHandler, deployOtpVerifyHandler } from "./guest";
export { deployPinVerifyHandler } from "./pin";

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

  // 5. Access-PIN cookie. Anonymous; bound to the route's CURRENT pin hash
  //    so rotating/removing the PIN revokes every outstanding cookie.
  if (await pinCookieAllows(c, domain, org.accessPinHash)) {
    return allow(c, "", "");
  }

  // 6. Unauthenticated → bounce to the access wall (org login OR email code).
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
    // `wall` = org/email variant; `wall-pin` = the PIN-only variant a route
    // with a configured PIN renders.
    if (preview === "wall" || preview === "wall-pin") {
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
          hasPin={preview === "wall-pin"}
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
