/**
 * Membership for the life of a terminal session.
 *
 * The ticket that opens /pty is minted by an org-scoped call, so membership is
 * checked once, at mint. A shell then runs for as long as the tab keeps the
 * socket open: a member removed from the organization kept a live shell into
 * its containers (or the host) until they closed it themselves.
 *
 * `watchTerminalMembership` re-reads the member table on an interval and calls
 * `onRevoked` once the user is gone, so the session ends within one interval
 * of the removal. A lookup that fails (Postgres blip) is not a verdict: the
 * session continues and the next tick tries again.
 */
import { isOrgMember } from "@otterdeploy/api/authz/org-member";
import { Result } from "better-result";
import { log } from "evlog";

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
  const isMember = watch.isMember ?? isOrgMember;
  let stopped = false;
  let checking = false;

  const tick = async () => {
    if (stopped || checking) return;
    checking = true;
    const checked = await Result.tryPromise({
      try: () => isMember(watch.userId, watch.organizationId),
      catch: (cause) => cause,
    });
    checking = false;
    if (stopped) return;
    if (checked.isErr()) {
      log.warn({ pty: { event: "membership-check-failed" }, error: String(checked.error) });
      return;
    }
    if (!checked.value) {
      stopped = true;
      clearInterval(timer);
      log.info({
        pty: { event: "membership-revoked", organizationId: watch.organizationId },
      });
      watch.onRevoked();
    }
  };

  const timer = setInterval(() => void tick(), watch.intervalMs ?? TERMINAL_MEMBERSHIP_RECHECK_MS);
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
