/**
 * Pure core of the in-flight deploy scan: the union logic, factored away
 * from ./queues (whose import graph reaches @otterdeploy/env) so it can be
 * unit-tested against fake queues with no Redis and no env.
 */

// Queued, running, delayed for retry, or on a paused queue: anything short of
// completed/failed. Mirrors the interrupted-deploy reconciler's state set.
export const IN_FLIGHT_STATES = ["waiting", "active", "delayed", "paused"] as const;

type InFlightState = (typeof IN_FLIGHT_STATES)[number];

export interface InFlightDeploys {
  /** deploymentIds owned by any in-flight (queued/active/delayed/paused) job,
   *  across every deploy lane. */
  ownedIds: Set<string>;
  /** Is ANY lane's worker actively processing a build right now? False with
   *  a non-empty backlog means no builder is consuming its queue. */
  anyActive: boolean;
}

/** The two queue reads the scan needs: structurally satisfied by a BullMQ
 *  Queue, and by a plain object in tests. The states param is the literal
 *  in-flight union (a subset of BullMQ's JobType) so a real Queue's stricter
 *  signature stays method-bivariance-compatible. */
export interface InFlightQueueLike {
  getJobs(
    states: InFlightState[],
  ): Promise<Array<{ data?: { deploymentIds?: unknown } } | undefined>>;
  getJobCounts(...states: InFlightState[]): Promise<Record<string, number | undefined>>;
}

/** Union the in-flight state of every given deploy queue (one per lane). */
export async function collectInFlightDeploys(
  queues: ReadonlyArray<InFlightQueueLike>,
): Promise<InFlightDeploys> {
  const perQueue = await Promise.all(
    queues.map(async (queue) => {
      const [jobs, counts] = await Promise.all([
        queue.getJobs([...IN_FLIGHT_STATES]),
        queue.getJobCounts("active"),
      ]);
      return { jobs, active: counts.active ?? 0 };
    }),
  );

  const ownedIds = new Set<string>();
  let anyActive = false;
  for (const { jobs, active } of perQueue) {
    if (active > 0) anyActive = true;
    for (const job of jobs) {
      const ids = job?.data?.deploymentIds;
      if (Array.isArray(ids)) {
        for (const id of ids) if (typeof id === "string") ownedIds.add(id);
      }
    }
  }
  return { ownedIds, anyActive };
}
