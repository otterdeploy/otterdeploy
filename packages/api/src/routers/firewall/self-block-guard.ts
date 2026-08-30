/**
 * Keep the firewall from banning the people operating it.
 *
 * The Flagged tab's targets come from the edge access log, which records who
 * connected — not whether that someone is currently signed in to this very
 * panel. Nothing stopped a mass block from including the operator's own
 * address, and CrowdSec enforces at the edge, so the 403 that follows also
 * takes away the screen you would use to undo it.
 *
 * Two different postures, because the two actions mean different things:
 *
 *   block      One address, typed or clicked deliberately. Refused only when
 *              it covers the CALLER's own address — you cannot lock yourself
 *              out by accident, but banning a range that happens to contain a
 *              colleague stays an admin's call to make.
 *
 *   blockMany  A sweep over rows nobody read one by one. Every address with a
 *              live session is skipped and counted, and the count is returned
 *              so the UI can say so rather than quietly banning fewer than it
 *              was asked to.
 *
 * Containment, not equality: `172.71.0.0/16` covers the operator's
 * `172.71.4.9`, and the range block is the one that locks people out.
 */
import { coveredBy, ipMatcher } from "../../security/ip-match";
import { activeSessionIps, callerIp } from "../../security/session-ips";

export interface SweepResult {
  /** Targets that survived the guard, in the order they were given. */
  allowed: string[];
  /** Targets dropped because a signed-in session sits behind them. */
  skipped: string[];
}

/**
 * Split a batch into what may be blocked and what must not be.
 *
 * An unparseable target is left in `allowed` rather than dropped here: this
 * guard's job is sessions, and cscli is the authority on what is a valid
 * address. Silently swallowing malformed input would turn a typo into a
 * successful no-op.
 */
export async function sweepBlockTargets(targets: readonly string[]): Promise<SweepResult> {
  const sessions = await activeSessionIps();
  if (sessions.size === 0) return { allowed: [...targets], skipped: [] };

  const allowed: string[] = [];
  const skipped: string[] = [];
  for (const target of targets) {
    if (coveredBy(target, sessions).length > 0) skipped.push(target);
    else allowed.push(target);
  }
  return { allowed, skipped };
}

/**
 * Whether `target` would cut off the caller themselves.
 *
 * Returns false when the caller's address is unknown (a direct, unproxied
 * request, where `sanitizeForwardingHeaders` has stripped the header it would
 * have come from). That is the honest answer — we cannot claim a match we
 * cannot make — and it fails toward letting an admin act rather than blocking
 * every manual ban on an install without a trusted proxy in front.
 */
export function blocksCaller(target: string, headers: Headers): boolean {
  const mine = callerIp(headers);
  if (!mine) return false;
  const matches = ipMatcher(target);
  return matches !== null && matches(mine);
}
