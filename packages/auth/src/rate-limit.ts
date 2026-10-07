/**
 * better-auth's request rate limit, by endpoint.
 *
 * The limiter keys a bucket by client IP AND path, so every auth endpoint has
 * its own per-IP budget. The default budget exists for the endpoints brute
 * force goes after: sign-in, sign-up, password reset, OTP, invitations.
 * better-auth's own special rules still tighten the sign-in family further.
 *
 * The dashboard, though, reads the signed-in user's own session state on every
 * route change and on every full page load (`get-session`, `organization/list`,
 * the account pages' listings). A quick operator, two background tabs, a CLI
 * and a browser behind one office NAT easily spent the 100-a-minute default
 * on those reads alone, and the app then showed a full-screen error for a
 * request that guessed nothing. Those reads are not a brute-force surface: they
 * only ever describe the caller's own (cookie-proven) session. They get a
 * separate, much larger bucket instead of being exempt: still bounded, so a
 * runaway client is throttled, just never by ordinary use.
 */

/** Window of every auth rate-limit bucket. */
export const AUTH_RATE_LIMIT_WINDOW_SECONDS = 60;

/** Default per-IP, per-endpoint budget: sign-in, sign-up, reset, OTP, ... */
export const AUTH_RATE_LIMIT_MAX_REQUESTS = 100;

/** Per-IP, per-endpoint budget of the read-only session endpoints below:
 *  20 a second sustained, well above what any person's browsing produces. */
export const SESSION_READ_RATE_LIMIT_MAX_REQUESTS = 1_200;

/**
 * Read-only endpoints that describe only the caller's own session, as the web
 * app calls them while browsing (apps/web: lib/auth-queries.ts, the account
 * and workspace settings pages). Nothing here creates, changes or reveals
 * anything a guess could unlock; `organization/get-invitation` (looked up by
 * id) deliberately stays on the default budget.
 */
export const SESSION_READ_PATHS = [
  "/get-session",
  "/organization/list",
  "/organization/list-members",
  "/organization/list-invitations",
  "/list-sessions",
  "/list-accounts",
  "/passkey/list-user-passkeys",
  "/api-key/list",
] as const;

export interface RateLimitRule {
  window: number;
  max: number;
}

/** The `rateLimit` option of the better-auth instance. */
export const authRateLimit = {
  enabled: true,
  window: AUTH_RATE_LIMIT_WINDOW_SECONDS,
  max: AUTH_RATE_LIMIT_MAX_REQUESTS,
  customRules: Object.fromEntries(
    SESSION_READ_PATHS.map((path): [string, RateLimitRule] => [
      path,
      { window: AUTH_RATE_LIMIT_WINDOW_SECONDS, max: SESSION_READ_RATE_LIMIT_MAX_REQUESTS },
    ]),
  ),
};
