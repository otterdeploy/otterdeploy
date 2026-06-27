/**
 * Shared infrastructure for the deployment-protection wall routes: cookie
 * constants, the env-derived web base, the Result-based boundary `guard`, the
 * branded error pages, and small request helpers (host/path sanitizers, cookie
 * options, the forward_auth allow). Split out of deploy-protection.tsx; nothing
 * here is part of the public route surface.
 */

import type { Context, Handler } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

import { env } from "@otterdeploy/env/server";
import { Result } from "better-result";

import { ErrorPage } from "./deploy-protection-frame";

export const SESSION_COOKIE = "__otter_auth";
export const GUEST_COOKIE = "__otter_guest";
export const SHARE_COOKIE = "__otter_share";
export const BYPASS_HEADER = "x-otter-bypass";

export const SESSION_COOKIE_MAX_AGE = 60 * 60; // 1h — matches the session token TTL
export const GUEST_COOKIE_MAX_AGE = 30 * 24 * 60 * 60; // bounded; real expiry is the token's own exp
export const SHARE_COOKIE_MAX_AGE = 7 * 24 * 60 * 60; // bounded; real expiry is the token's own exp

/** Web app base, for the login redirect. The auth *authority* (getSession)
 *  is BETTER_AUTH_URL; the login UI is the web app. */
export const WEB_BASE = env.PUBLIC_WEB_URL ?? env.CORS_ORIGIN[0] ?? env.BETTER_AUTH_URL;

/** Render a branded error page for a known, browser-facing failure (bad/expired
 *  link, unknown deployment). Never leaks internals — title/detail are fixed
 *  copy. Used in place of the old raw `c.text("…")` returns. */
export const errorPage = (
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
export const guard =
  (handler: Handler, fallback: (c: Context) => Response | Promise<Response>): Handler =>
  async (c, next) =>
    (
      await Result.tryPromise({
        try: async (): Promise<Response | void> => handler(c, next) as Response | void,
        catch: (e) => e,
      })
    ).match<Response | void | Promise<Response>>({
      ok: (res) => res,
      err: (cause) => {
        c.get("log").error(cause);
        return fallback(c);
      },
    });

/** The 500 fallback for HTML wall routes — a branded "something went wrong". */
export const serverError = (c: Context): Response | Promise<Response> =>
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
export const authTargetDomain = (c: Context): string | null => c.req.query("domain") ?? null;

export function cookieOptions(maxAge: number) {
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
export function allow(c: Context, userId: string, email: string): Response {
  c.header("Remote-User", userId);
  c.header("Remote-Email", email);
  return c.body(null, 200);
}

/** Strip a port and lowercase — the cookie must be scoped to the bare host. */
export function hostOf(header: string | undefined): string | null {
  if (!header) return null;
  return header.split(":")[0]?.toLowerCase() || null;
}

/** Only allow same-origin absolute paths — reject schemes and protocol-
 *  relative `//evil.com` to prevent open redirects. The second-char `\\`
 *  check matters too: browsers fold `\` to `/`, so `/\evil.com` would
 *  resolve as protocol-relative `//evil.com`. */
export function sanitizePath(input: string | undefined): string {
  if (!input || input[0] !== "/" || input[1] === "/" || input[1] === "\\") {
    return "/";
  }
  return input;
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
