/**
 * Raft quorum arithmetic, for warning an operator before they make their
 * cluster *less* available by promoting a second manager.
 *
 * A swarm needs a majority of managers alive. The majority of 2 is 2, so a
 * two-manager cluster tolerates ZERO failures, exactly like a one-manager
 * cluster, except now there are two machines whose loss takes the control
 * plane down instead of one. Adding the second manager is strictly worse, and
 * it is the obvious-looking thing to do when you buy a second server.
 *
 * Only odd counts add fault tolerance: 3 tolerates 1, 5 tolerates 2.
 */

/** Managers that may fail while the swarm still schedules, heals and deploys. */
export function failuresTolerated(managerCount: number): number {
  if (managerCount < 1) return 0;
  // quorum = floor(n/2) + 1; anything beyond quorum may fail.
  return managerCount - Math.floor(managerCount / 2) - 1;
}

/** Would adding one more manager buy any additional fault tolerance? */
export function promotionAddsResilience(currentManagerCount: number): boolean {
  return failuresTolerated(currentManagerCount + 1) > failuresTolerated(currentManagerCount);
}

/**
 * Operator-facing warning when adding one more control plane would not help,
 * or would actively hurt. Null when it is a sound choice. Worded for the Add a
 * server dialog's "Control plane" checkbox, in the product's words rather
 * than the scheduler's.
 */
export function managerPromotionWarning(currentManagerCount: number): string | null {
  if (promotionAddsResilience(currentManagerCount)) return null;
  const next = currentManagerCount + 1;
  if (next === 2) {
    return "A second control plane makes this less available, not more: both would then have to stay up. It takes three to survive losing one. Leave this unchecked.";
  }
  return `Going from ${currentManagerCount} to ${next} control planes survives no extra failures. Keep the count odd, or leave this unchecked.`;
}
