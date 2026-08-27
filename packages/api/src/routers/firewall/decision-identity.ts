/**
 * How a live CrowdSec decision is matched to a row we already recorded.
 *
 * The whole correctness of the recorder rests here. Match too loosely and two
 * different bans collapse into one row; match too strictly and every poll
 * "ends" the decision it just saw and opens a new one, turning one 30-minute
 * ban into thirty one-minute rows.
 *
 * Its own module because the rule is worth testing on its own, and because
 * both sides of the diff — the live decision and the stored row — have to
 * derive the key exactly the same way or nothing ever matches.
 */
import type { Decision } from "./decisions-read";

/** CrowdSec's own id when it gave us one; otherwise what identifies the ban
 *  itself. Deliberately excludes `duration`, which counts DOWN between polls
 *  and would make every tick look like a new decision. */
export function decisionIdentity(decision: Decision): string {
  return decision.id != null
    ? `id:${decision.id}`
    : `k:${decision.value}|${decision.scope}|${decision.scenario}|${decision.origin}`;
}

/** The same key, derived from a stored row. Kept beside its twin so the two
 *  cannot drift. */
export function rowIdentity(row: {
  lapiId: number | null;
  value: string;
  scope: string;
  scenario: string;
  origin: string;
}): string {
  return row.lapiId != null
    ? `id:${row.lapiId}`
    : `k:${row.value}|${row.scope}|${row.scenario}|${row.origin}`;
}
