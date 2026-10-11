/**
 * Membership for the life of a long-lived connection.
 *
 * A connection that outlives a single request (a terminal session, the
 * dashboard's live socket) was authorized when it opened. `watchMembership`
 * re-reads the member table on an interval and calls `onRevoked` once the user
 * is gone, so the connection ends within one interval of the removal. A lookup
 * that fails (Postgres blip) is not a verdict: the connection continues and the
 * next tick tries again.
 */
import { isOrgMember } from "@otterdeploy/api/authz/org-member";
import { Result } from "better-result";
import { log } from "evlog";

export interface MembershipWatch {
  userId: string;
  organizationId: string;
  onRevoked: () => void;
  intervalMs: number;
  /** The log namespace of the connection being watched. */
  logAs: "pty" | "live";
  /** Seam for tests; production reads the member table. */
  isMember?: (userId: string, organizationId: string) => Promise<boolean>;
}

/** Start watching; returns the function that stops it (call it on close). */
export function watchMembership(watch: MembershipWatch): () => void {
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
      log.warn({
        [watch.logAs]: { event: "membership-check-failed" },
        error: String(checked.error),
      });
      return;
    }
    if (!checked.value) {
      stopped = true;
      clearInterval(timer);
      log.info({
        [watch.logAs]: { event: "membership-revoked", organizationId: watch.organizationId },
      });
      watch.onRevoked();
    }
  };

  const timer = setInterval(() => void tick(), watch.intervalMs);
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
