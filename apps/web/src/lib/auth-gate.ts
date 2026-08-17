/**
 * Where the `_app` gate sends a visitor, as a pure function of the two auth
 * reads. Split out of routes/_app/layout.tsx so it can be tested without a
 * router, a query client, or a live server.
 *
 * This exists because the gate has now got it wrong twice in opposite
 * directions, and both were user-visible:
 *
 *   1. A rate-limited (429) session read was treated as "signed out" and
 *      bounced an operator holding a valid session to /sign-in.
 *   2. A signed-out visitor's 401 on the org list THREW, rejecting the
 *      concurrent `Promise.all` before the sign-in redirect could run, and
 *      surfaced a 500 "something went wrong" screen instead.
 *
 * The rule that satisfies both: only a definite ANSWER about identity may
 * redirect. A resolved-but-absent session and a 401 are answers ("nobody is
 * signed in"). Transport failures are not answers at all. They throw upstream
 * in the query functions and never reach this decision.
 */

import type { OrganizationList, OrganizationSummary } from "@/lib/auth-queries";

export type AuthGateDecision =
  /** Nobody is signed in. Go to /sign-in, preserving where they were headed. */
  | { kind: "sign-in" }
  /** Signed in, but belongs to no workspace yet. */
  | { kind: "onboarding" }
  /**
   * Signed in with at least one workspace; render the app. Carries the list
   * back non-nullable so the caller doesn't have to re-narrow what this
   * function already proved.
   */
  | { kind: "allow"; organizations: OrganizationSummary[] };

export function decideAuthGate(input: {
  /** Resolved session, or null when the server answered "no session". */
  session: unknown;
  /** Resolved org list, or null when the org endpoint answered 401. */
  organizations: OrganizationList;
}): AuthGateDecision {
  // Checked before the empty-list branch, and `organizations === null` is NOT
  // redundant with `!session`: the session read is served from a 5-minute
  // cache, so a cookie expiring mid-window leaves a cached session sitting
  // next to a live 401. Treating that as "no orgs" would drop a signed-out
  // visitor into workspace creation instead of the sign-in page.
  if (!input.session || input.organizations === null) return { kind: "sign-in" };
  if (input.organizations.length === 0) return { kind: "onboarding" };
  return { kind: "allow", organizations: input.organizations };
}
