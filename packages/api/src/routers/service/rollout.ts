/**
 * An image service's rollout, off the request.
 *
 * `service.create`, `service.update` and `service.restart` used to wait for
 * the health-gated rollout inside the request. Readiness can take up to 20
 * minutes (runtime/readiness.ts) and the procedure deadline is 120 s, so a
 * rollout that needed longer (an image still pulling, a port nothing listens
 * on) answered TIMEOUT, stored no deployment and no reason, and left the
 * service reading "starting" while the server kept rolling.
 *
 * Now the request saves the change, records a `pending` deployment row (which
 * also stamps its id onto the new version's labels and points its Deploy Logs
 * at it, routers/service/spec.ts), enqueues `service.rollout` and answers with
 * that row's id. The job (wired in apps/server) rolls the service, still
 * health-gated: the previous version keeps serving until the new one is ready,
 * and one that never gets ready is rolled back. Its outcome lands on the row:
 * `running`, or `failed` with the reason. markDeploymentFailed and
 * reconcileDeploySuccess publish the change on the project stream, so the
 * dashboard updates as it always did; the CLI follows the row.
 *
 * Redis unreachable: the enqueue fails fast (QUEUE_READY_TIMEOUT_MS) and the
 * same rollout runs in this process instead, still off the request.
 */
import type { DeploymentId, OrganizationId, ProjectId, ResourceId } from "@otterdeploy/shared/id";
import type { JsonObject } from "@otterdeploy/shared/json";
import type { RequestLogger } from "evlog";

import { type ServiceRolloutPayload, triggerServiceRollout } from "@otterdeploy/jobs";
import { Result } from "better-result";
import { createRequestLogger, log as globalLog } from "evlog";

import type { ResolveError } from "./errors";

import { resolveServiceEnv } from "../../lib/variables";
import { type DeploymentRow, insertDeployment, markDeploymentFailed } from "../project/deployments";
import { reconcileDeploySuccess } from "../project/deployments-reconcile";
import { loadResource } from "./context";
import { updateServiceResourceStatus } from "./queries";
import { provisionFresh, redeployDependents, redeployOne } from "./redeploy";

export interface RolloutRequest {
  /** `create`: the service has never run. `roll`: replace what runs. */
  kind: ServiceRolloutPayload["kind"];
  projectId: ProjectId;
  organizationId: OrganizationId;
  resourceId: ResourceId;
  reason: DeploymentRow["reason"];
  image: string;
  snapshot: JsonObject;
  /** Also roll the services that reference this one, after it settles. */
  fanOut: boolean;
  log: RequestLogger;
}

/** The seam tests (and nothing else) replace: how a rollout leaves the request. */
export const rolloutDispatch = {
  enqueue: (payload: ServiceRolloutPayload): Promise<unknown> => triggerServiceRollout(payload),
};

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/**
 * Can this service's env resolve right now? Asked in the request, before any
 * row exists, so a broken `${{ref}}` is still the caller's typed error
 * (REF_MISSING, REF_CYCLE, …) and not a failed deployment they have to go and
 * find. Marks the resource invalid on failure, as the inline roll did.
 */
export async function checkRolloutResolvable(
  projectId: ProjectId,
  resourceId: ResourceId,
): Promise<Result<true, ResolveError>> {
  const resolved = await resolveServiceEnv(projectId, resourceId);
  if (resolved.isOk()) return Result.ok(true);
  await updateServiceResourceStatus(resourceId, "invalid");
  return Result.err(resolved.error);
}

/** Record the deployment and hand its rollout to the background. Returns the
 *  row's id as soon as the row exists; the outcome lands on it later. */
export async function startRollout(input: RolloutRequest): Promise<DeploymentId> {
  const row = await insertDeployment({
    resourceId: input.resourceId,
    image: input.image,
    reason: input.reason,
    // Nothing is built: the image is pulled. "building" would claim a build.
    status: "pending",
    snapshot: input.snapshot,
  });
  const payload: ServiceRolloutPayload = {
    kind: input.kind,
    projectId: input.projectId,
    organizationId: input.organizationId,
    resourceId: input.resourceId,
    deploymentIds: [row.id],
    fanOut: input.fanOut,
  };
  input.log.set({ rollout: { deploymentId: row.id } });
  // Not awaited: with Redis unreachable the enqueue waits out its ready
  // budget before failing, and the answer must not wait for that either.
  void dispatchRollout(payload);
  return row.id;
}

/** Hand the rollout to the queue; when the queue cannot take it, run it here.
 *  Never rejects (every step is a Result), so nothing floats unhandled. */
async function dispatchRollout(payload: ServiceRolloutPayload): Promise<void> {
  const enqueued = await Result.tryPromise({
    try: () => rolloutDispatch.enqueue(payload),
    catch: describe,
  });
  if (enqueued.isOk()) return;
  globalLog.warn({
    rollout: { deploymentId: payload.deploymentIds[0], queued: false, why: enqueued.error },
  });
  await runServiceRollout(payload);
}

type Outcome = { ok: true } | { ok: false; reason: string };

interface OwnRoll {
  outcome: Outcome;
  /** Null when the service or its project is gone: nothing to fan out to. */
  projectSlug: string | null;
}

async function rollOwn(payload: ServiceRolloutPayload, log: RequestLogger): Promise<OwnRoll> {
  const loaded = await loadResource(payload);
  if (loaded.isErr())
    return { outcome: { ok: false, reason: loaded.error.message }, projectSlug: null };
  const { project, record } = loaded.value;
  const rolled =
    payload.kind === "create"
      ? await provisionFresh(payload.projectId, record, project.slug, log)
      : await redeployOne(payload.projectId, payload.resourceId, project.slug, log);
  if (rolled.isErr()) {
    return { outcome: { ok: false, reason: rolled.error.message }, projectSlug: project.slug };
  }
  const runtime = rolled.value;
  const outcome: Outcome =
    runtime.status === "error"
      ? { ok: false, reason: runtime.errorMessage ?? "the runtime reported an error state" }
      : { ok: true };
  return { outcome, projectSlug: project.slug };
}

/** Write the outcome to the row. Both writes are guarded on a still-in-flight
 *  row (an operator's cancel that landed first stays), and both publish. */
async function settle(
  deploymentId: DeploymentId,
  resourceId: ResourceId,
  outcome: Outcome,
): Promise<void> {
  if (outcome.ok) await reconcileDeploySuccess([deploymentId], resourceId);
  else await markDeploymentFailed(deploymentId, outcome.reason);
}

/**
 * The `service.rollout` job body (apps/server wires it). Never rejects: a
 * rollout that throws is a failed deployment with the reason, not a job crash
 * that leaves the row `pending` for the orphan sweep to find much later.
 */
export async function runServiceRollout(payload: ServiceRolloutPayload): Promise<void> {
  const [deploymentId] = payload.deploymentIds;
  if (!deploymentId) return;
  const log = createRequestLogger({ method: "JOB", path: "service.rollout" });
  log.set({ rollout: { kind: payload.kind, deploymentId, resourceId: payload.resourceId } });

  const rolled = await Result.tryPromise({ try: () => rollOwn(payload, log), catch: describe });
  const own: OwnRoll = rolled.isOk()
    ? rolled.value
    : { outcome: { ok: false, reason: `the rollout stopped: ${rolled.error}` }, projectSlug: null };
  const settled = await Result.tryPromise({
    try: () => settle(deploymentId, payload.resourceId, own.outcome),
    catch: describe,
  });
  log.set({
    rollout: { outcome: own.outcome, settleError: settled.isErr() ? settled.error : null },
  });

  // Dependents roll after the row has its outcome: the caller following it
  // waits for this service, not for everything that references it.
  const projectSlug = own.projectSlug;
  if (payload.fanOut && projectSlug !== null) {
    const fanned = await Result.tryPromise({
      try: () => redeployDependents(payload.projectId, payload.resourceId, projectSlug, log),
      catch: describe,
    });
    const failure = fanned.isErr()
      ? fanned.error
      : fanned.value.isErr()
        ? fanned.value.error.message
        : null;
    if (failure) log.set({ rollout: { dependentsError: failure } });
  }
  log.emit();
}
