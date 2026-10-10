/**
 * What the control plane knows about GitHub's REST budget for its PUBLIC-repo
 * reads, so a spent budget is learned once instead of re-discovered (and
 * re-failed, up to 15 s each) by every deploy.
 *
 * An anonymous caller gets 60 requests an hour per source IP, and every
 * public-repo deploy used to spend several (after a handful of deploys every
 * later one failed "GitHub commit lookup failed (403)"). Git
 * has no such budget, so the callers ask git first; this module is what the
 * remaining API reads consult before spending a request, and where they report
 * what GitHub told them.
 *
 * Process-local on purpose: it only avoids wasted calls. GitHub stays the
 * authority, and a restart just re-learns the state from the next response.
 */
import { env } from "@otterdeploy/env/server";
import { Temporal } from "@otterdeploy/shared/temporal";

/** `anonymous` shares one budget per egress IP; `token` is the configured
 *  GITHUB_API_TOKEN's own (5000 an hour). They exhaust independently. */
export type ApiBudgetClass = "anonymous" | "token";

/** The configured token for public-repo reads, or null (anonymous). */
export function configuredGithubToken(): string | null {
  return env.GITHUB_API_TOKEN ?? null;
}

/** Which budget a public-repo read draws on. */
export function publicReadClass(): ApiBudgetClass {
  return configuredGithubToken() ? "token" : "anonymous";
}

const MIN_BACKOFF_MS = 30_000;
const MAX_BACKOFF_MS = 65 * 60_000;
/** When GitHub says it is limiting us but not for how long. */
const UNKNOWN_BACKOFF_MS = 10 * 60_000;
/** The API is unreachable (blocked egress, DNS, timeout): stop trying for a
 *  minute rather than paying the request timeout on every deploy. */
const UNREACHABLE_BACKOFF_MS = 60_000;

const spentUntil = new Map<ApiBudgetClass, number>();

function nowMs(): number {
  return Temporal.Now.instant().epochMilliseconds;
}

/** True while `cls` is known to be spent: skip the API, use git. */
export function apiBudgetSpent(cls: ApiBudgetClass): boolean {
  const until = spentUntil.get(cls);
  if (until === undefined) return false;
  if (until > nowMs()) return true;
  spentUntil.delete(cls);
  return false;
}

/** Forget what was learned (tests; a token being configured). */
export function resetApiBudget(): void {
  spentUntil.clear();
}

function markSpent(cls: ApiBudgetClass, forMs: number): void {
  const clamped = Math.min(Math.max(forMs, MIN_BACKOFF_MS), MAX_BACKOFF_MS);
  spentUntil.set(cls, nowMs() + clamped);
}

interface BudgetResponse {
  status: number;
  headers: { get(name: string): string | null };
}

function headerNumber(res: BudgetResponse, name: string): number | null {
  const raw = res.headers.get(name);
  if (raw === null) return null;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * Record what a response says about the budget. Call it on every response of a
 * public-repo read, success included: the call that spends the LAST request
 * says `x-ratelimit-remaining: 0` on a 200, and noting it saves the next
 * caller a failing round trip.
 */
export function noteGithubResponse(cls: ApiBudgetClass, res: BudgetResponse, body = ""): void {
  const remaining = headerNumber(res, "x-ratelimit-remaining");
  const resetEpochSeconds = headerNumber(res, "x-ratelimit-reset");
  const retryAfterSeconds = headerNumber(res, "retry-after");
  const limited =
    remaining === 0 ||
    res.status === 429 ||
    (res.status === 403 && /rate limit/i.test(body)) ||
    (res.status === 403 && retryAfterSeconds !== null);
  if (!limited) return;
  if (retryAfterSeconds !== null) return markSpent(cls, retryAfterSeconds * 1000);
  if (resetEpochSeconds !== null) return markSpent(cls, resetEpochSeconds * 1000 - nowMs());
  markSpent(cls, UNKNOWN_BACKOFF_MS);
}

/** The API could not be reached at all. */
export function noteGithubUnreachable(cls: ApiBudgetClass): void {
  markSpent(cls, UNREACHABLE_BACKOFF_MS);
}
