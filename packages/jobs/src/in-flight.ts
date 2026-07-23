/**
 * In-flight `deploy.triggered` job state, for the stale-build watchdog.
 *
 * The worker runs `concurrency=1` by default, so triggering several deploys
 * queues them behind the active build. Those queued deploys produce no log
 * output while they wait their turn — the watchdog must NOT mistake that
 * silence for a dead build. But it must STILL catch a genuinely-down builder
 * (a job that sits queued because nothing is consuming it).
 *
 * The discriminator is `anyActive`: while the worker is actively processing
 * SOME build, a queued deploy is legitimately waiting; when there's a backlog
 * but nothing active, the builder isn't consuming and a long-silent deploy is
 * fair game to fail.
 */
import { deployTriggeredJob } from "./jobs/deploy";
import { getQueue } from "./queues";

// Queued, running, delayed for retry, or on a paused queue — anything short of
// completed/failed. Mirrors the interrupted-deploy reconciler's state set.
const IN_FLIGHT_STATES = ["waiting", "active", "delayed", "paused"] as const;

export interface InFlightDeploys {
  /** deploymentIds owned by any in-flight (queued/active/delayed/paused) job. */
  ownedIds: Set<string>;
  /** Is the worker actively processing at least one build right now? False with
   *  a non-empty backlog means the builder isn't consuming the queue. */
  anyActive: boolean;
}

export async function inFlightDeploys(): Promise<InFlightDeploys> {
  const queue = getQueue(deployTriggeredJob.name);
  const [jobs, counts] = await Promise.all([
    queue.getJobs([...IN_FLIGHT_STATES]),
    queue.getJobCounts("active"),
  ]);
  const ownedIds = new Set<string>();
  for (const job of jobs) {
    const ids = (job?.data)?.deploymentIds;
    if (Array.isArray(ids)) for (const id of ids) ownedIds.add(id);
  }
  return { ownedIds, anyActive: (counts.active ?? 0) > 0 };
}
