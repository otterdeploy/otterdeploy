/**
 * Cached reads of the two better-auth endpoints the app gate depends on.
 *
 * WHY THESE ARE CACHED
 * The `_app` beforeLoad used to call `authClient.getSession()` and
 * `authClient.organization.list()` directly on EVERY navigation — two HTTP
 * round-trips to `/api/auth/*` per route entry. Auth endpoints are rate limited
 * (100 requests / 60s, packages/auth/src/index.ts), and that bucket is keyed by
 * IP — which resolves to nothing when the caller isn't behind a trusted proxy,
 * putting every tab and every user in ONE shared bucket. Clicking around the app
 * exhausted it in well under a minute.
 *
 * WHY THAT LOOKED LIKE BEING LOGGED OUT
 * A rate-limited read returns `{ data: null, error: { status: 429 } }`. The gate
 * only tested `!session.data`, so a 429 was indistinguishable from "not signed
 * in" and bounced the operator to /sign-in holding a perfectly valid session.
 * `sessionQuery` below closes that hole at the source: a failed REQUEST throws
 * (the router surfaces it, nothing is signed out), while a genuinely absent
 * session resolves to `null`. Only `null` may redirect.
 *
 * STALE TIME
 * 5 minutes, deliberately matched to better-auth's own `session.cookieCache`
 * maxAge. The server already serves a cached session for up to that long, so
 * caching the client read for the same window introduces no staleness that
 * didn't already exist — a revoked session is honored for ≤5min either way.
 *
 * INVALIDATION
 * Anything that changes who is signed in, or which org is active, must call
 * {@link invalidateAuth} — sign-out, sign-in, org switch, org create. The
 * session payload carries `activeOrganizationId`, so an org switch is a session
 * change, not just an org-list change.
 */

import { idSchema, type OrganizationId } from "@otterdeploy/shared/id";
import { queryOptions } from "@tanstack/react-query";

import { authClient } from "@/lib/auth-client";
import { authQueryKeys } from "@/lib/auth-query-keys";
import { queryClient } from "@/shared/server/orpc";

const FIVE_MINUTES = 5 * 60 * 1000;

type SessionData = Awaited<ReturnType<typeof authClient.getSession>>["data"];

export const sessionQuery = queryOptions({
  queryKey: authQueryKeys.currentSession,
  queryFn: async (): Promise<SessionData> => {
    const res = await authClient.getSession();
    // A transport/ratelimit/server failure is NOT a signed-out user. Throwing
    // keeps it out of the cache and lets the caller tell the two apart; the
    // gate must never turn this into a redirect to /sign-in.
    if (res.error) {
      throw new Error(res.error.message ?? "Couldn't verify your session");
    }
    // 200 with a null body — genuinely not signed in.
    return res.data ?? null;
  },
  staleTime: FIVE_MINUTES,
});

export interface OrganizationSummary {
  id: OrganizationId;
  name: string;
  slug: string;
  logo?: string | null;
  createdAt: string | Date;
}

/**
 * `null` means UNAUTHENTICATED — the org list is unknowable because nobody is
 * signed in. Distinct from `[]`, which means "signed in, genuinely no orgs" and
 * sends the user to onboarding. Collapsing the two would route a signed-out
 * visitor into org creation instead of the sign-in page.
 */
export type OrganizationList = OrganizationSummary[] | null;

export const organizationsQuery = queryOptions({
  queryKey: authQueryKeys.organizations,
  queryFn: async (): Promise<OrganizationList> => {
    const res = await authClient.organization.list();
    if (res.error) {
      // 401 is not a failure, it is an ANSWER: this endpoint requires a session
      // and there isn't one. It has to resolve rather than throw, because the
      // gate reads this concurrently with `sessionQuery` — a throw here rejects
      // the whole `Promise.all` before the `!session` redirect can run, turning
      // an ordinary signed-out visit into a 500 error screen.
      //
      // Deliberately ONLY 401. Every other status still throws, which is what
      // keeps a 429 or a briefly-unreachable server from masquerading as a
      // logout (the bug this file's header describes) — those are failures to
      // surface, not evidence about who is signed in.
      if (res.error.status === 401) return null;
      throw new Error(res.error.message ?? "Failed to load organizations");
    }
    // Brand every org id at this single entry point (better-auth types them as
    // plain `string`). Downstream `organization.id` is `OrganizationId` for
    // free — no per-callsite laundering. Safe at runtime: auth's `generateId`
    // override always prefixes org ids with `org_` (packages/auth/src/index.ts).
    return (res.data ?? []).map((o) => ({
      ...o,
      id: idSchema.organization.parse(o.id),
    }));
  },
  staleTime: FIVE_MINUTES,
});

/**
 * Refresh the cached session + org list. Call after ANY change to identity or
 * the active organization; the gate then reads the new truth.
 *
 * `refetchType: "all"` is load-bearing, not a tuning knob. Two defaults compose
 * into a silent no-op without it:
 *
 *   1. `invalidateQueries` only refetches queries with a live observer
 *      (`type: "active"`). Nothing subscribes to these two — they exist purely
 *      to be read by `_app`'s `beforeLoad` — so plain invalidation marks them
 *      stale and refetches nothing.
 *   2. `ensureQueryData` returns cached data whenever it is defined, stale or
 *      not; it only fetches when there is no data at all.
 *
 * So the gate went on reading the pre-change list. Creating your first
 * organization in the wizard left `organizations: []` cached, and finishing
 * onboarding navigated into the app only to be bounced straight back to
 * `/onboarding/create-organization` by that stale empty list.
 *
 * Awaiting matters for the same reason: the returned promise settles once the
 * refetches land, so callers can navigate immediately after and know the gate
 * will read fresh data.
 */
export async function invalidateAuth(): Promise<void> {
  await queryClient.invalidateQueries({ queryKey: authQueryKeys.all, refetchType: "all" });
}

/**
 * Remove rather than invalidate — used on sign-out, where the cached user must
 * not linger in memory and there is no point refetching it.
 */
export function clearAuthCache(): void {
  queryClient.removeQueries({ queryKey: authQueryKeys.all });
}
