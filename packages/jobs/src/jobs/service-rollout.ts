import { ID_PREFIX, zId } from "@otterdeploy/shared/id";
import * as z from "zod";

import { defineJob } from "../define";

/**
 * The health-gated rollout of an image service, run off the request.
 * `service.create`, `service.update` and `service.restart` save the change,
 * record a deployment row and enqueue this job; the request answers with that
 * row's id. The rollout itself can take as long as its readiness
 * window (up to 20 minutes, runtime/readiness.ts), far past the 120 s procedure
 * deadline, so it cannot live inside the request: one that did answered
 * TIMEOUT, stored no outcome and left the service reading "starting".
 *
 * The REAL handler is wired in `apps/server` (it needs `@otterdeploy/api`'s
 * runtime drivers, which can't live here without inverting the dependency),
 * exactly like `server.provision`. It writes the outcome (running, or failed
 * with the reason, including "rolled back: the previous version keeps
 * serving") to the deployment row, which publishes it on the project stream.
 *
 * `deploymentIds` (one id) carries the same name as `deploy.triggered`'s so
 * the in-flight scans (in-flight.ts, reconcile.ts) see a row this job owns as
 * owned: the read-side success detector must not call a mid-gate candidate a
 * success, and the orphan sweep must not fail a rollout that is still gating.
 */
export const ServiceRolloutPayload = z.object({
  /** `create` provisions a service that has never run; `roll` updates one. */
  kind: z.enum(["create", "roll"]),
  projectId: zId(ID_PREFIX.project),
  organizationId: zId(ID_PREFIX.organization),
  resourceId: zId(ID_PREFIX.resource),
  deploymentIds: z.array(zId(ID_PREFIX.deployment)).length(1),
  /** Also roll the services that reference this one (`${{name.VAR}}`). */
  fanOut: z.boolean(),
});
export type ServiceRolloutPayload = z.infer<typeof ServiceRolloutPayload>;

export const serviceRolloutJob = defineJob({
  name: "service.rollout",
  schema: ServiceRolloutPayload,
  // Each rollout mostly waits on a readiness gate; one slow service must not
  // hold every other service's rollout behind it.
  concurrency: 16,
  opts: {
    // Never retried: a rollout re-run on its own would roll the service again
    // behind the operator's back. The row records the failure instead.
    attempts: 1,
    removeOnComplete: { age: 60 * 60 * 24 },
    removeOnFail: { age: 60 * 60 * 24 * 7 },
  },
  async handler(payload, { log }) {
    log.warn({
      rollout: { event: "no-handler", deploymentId: payload.deploymentIds[0] },
      why: "service.rollout reached the fallback handler; apps/server must wire the real one",
    });
    return { acknowledged: true };
  },
});
