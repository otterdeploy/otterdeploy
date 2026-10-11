/**
 * Membership for the life of a terminal session.
 *
 * The ticket that opens /pty is minted by an org-scoped call, so membership is
 * checked once, at mint. A shell then runs for as long as the tab keeps the
 * socket open: a member removed from the organization kept a live shell into
 * its containers (or the host) until they closed it themselves.
 *
 * `watchTerminalMembership` re-reads the member table on an interval (see
 * lib/membership-watch.ts) and calls `onRevoked` once the user is gone, so the
 * session ends within one interval of the removal.
 */
import { watchMembership } from "../../lib/membership-watch";

export const TERMINAL_MEMBERSHIP_RECHECK_MS = 10_000;

export interface TerminalMembershipWatch {
  userId: string;
  organizationId: string;
  onRevoked: () => void;
  intervalMs?: number;
  /** Seam for tests; production reads the member table. */
  isMember?: (userId: string, organizationId: string) => Promise<boolean>;
}

/** Start watching; returns the function that stops it (call it on close). */
export function watchTerminalMembership(watch: TerminalMembershipWatch): () => void {
  return watchMembership({
    ...watch,
    intervalMs: watch.intervalMs ?? TERMINAL_MEMBERSHIP_RECHECK_MS,
    logAs: "pty",
  });
}
