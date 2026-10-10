/**
 * In-flight `deploy.triggered` job state, for the stale-build watchdog.
 *
 * Workers run `concurrency=1` by default, so triggering several deploys
 * queues them behind the active build. Those queued deploys produce no log
 * output while they wait their turn. The watchdog must NOT mistake that
 * silence for a dead build. But it must STILL catch a genuinely-down builder
 * (a job that sits queued because nothing is consuming it).
 *
 * The discriminator is `anyActive`: while SOME lane is actively processing a
 * build, a queued deploy is legitimately waiting; when there's a backlog
 * but nothing active anywhere, no builder is consuming and a long-silent
 * deploy is fair game to fail.
 *
 * Scans EVERY deploy lane queue (see lanes.ts), not just the default: a
 * build queued on a named lane is just as owned as one on the shared queue.
 * The union itself lives in in-flight-core.ts so it stays purely testable.
 *
 * Also scans the `service.rollout` queue: an image service's rollout runs
 * there (jobs/service-rollout.ts) and owns its deployment row the same way a
 * build does, so a list read must not settle that row mid-gate either.
 */
import type { InFlightDeploys } from "./in-flight-core";

import { collectInFlightDeploys } from "./in-flight-core";
import { serviceRolloutJob } from "./jobs/service-rollout";
import { allDeployQueues, getQueue } from "./queues";

export type { InFlightDeploys } from "./in-flight-core";

export async function inFlightDeploys(): Promise<InFlightDeploys> {
  return collectInFlightDeploys([...(await allDeployQueues()), getQueue(serviceRolloutJob.name)]);
}
