/**
 * Watching a swarm rolling update to its real end.
 *
 * The update itself is already start-first with `FailureAction: rollback`
 * (internals.ts): swarm starts the new task, waits for it to be running (and
 * healthy, when it has a healthcheck), stops the old one, and rolls back when
 * the new task fails inside the `Monitor` window. What was missing was the
 * caller listening: it returned on the first `running` task it saw, which
 * during a start-first update is usually the OLD one, so a rollout swarm was
 * about to roll back read "running".
 *
 * Now the driver waits on the service's `UpdateStatus` until swarm says
 * `completed` or that it rolled back. A service with a port and no declared
 * healthcheck then gets the edge port probe swarm cannot do itself; if nothing
 * answers on the port the update is rolled back (`rollback=previous`). That
 * check runs after swarm's cutover, so declaring a healthcheck is what makes it
 * a pre-cutover gate on swarm.
 */
import type { Docker } from "@otterdeploy/docker";

import { Temporal } from "@otterdeploy/shared/temporal";
import { setTimeout as sleep } from "node:timers/promises";

import type { ReadinessPlan } from "../runtime/readiness";

import { probeEdgePort } from "../runtime/edge-probe";
import { assessReadiness, READINESS_START, READY_POLL_MS } from "../runtime/readiness";

/** How long a `rollback=previous` may take before we stop waiting on it. */
const ROLLBACK_WAIT_MS = 120_000;

export type SwarmUpdateOutcome =
  | { kind: "updating" }
  | { kind: "completed" }
  | { kind: "rolled-back"; message: string | null }
  | { kind: "paused"; message: string | null };

/** Map swarm's `UpdateStatus` to what it means for the deploy. Absent status
 *  is "updating": swarm clears it when the spec changes and sets it again once
 *  its updater picks the service up. */
export function swarmUpdateOutcome(
  status: { State?: string; Message?: string } | undefined,
): SwarmUpdateOutcome {
  const message = status?.Message?.trim() || null;
  switch (status?.State) {
    case "completed":
      return { kind: "completed" };
    case "rollback_completed":
      return { kind: "rolled-back", message };
    case "paused":
    case "rollback_paused":
      return { kind: "paused", message };
    default:
      return { kind: "updating" };
  }
}

function now(): number {
  return Temporal.Now.instant().epochMilliseconds;
}

async function updateStatus(docker: Docker, serviceId: string) {
  const inspected = await docker.services.getService(serviceId).inspect();
  return inspected.isOk() ? inspected.value.UpdateStatus : undefined;
}

/** Wait for swarm's own verdict on the update, up to `timeoutMs`. */
export async function awaitSwarmUpdate(
  docker: Docker,
  serviceId: string,
  timeoutMs: number,
): Promise<SwarmUpdateOutcome> {
  const deadline = now() + timeoutMs;
  for (;;) {
    const outcome = swarmUpdateOutcome(await updateStatus(docker, serviceId));
    if (outcome.kind !== "updating" || now() >= deadline) return outcome;
    await sleep(READY_POLL_MS);
  }
}

/** Ask swarm to put the previous spec back, and wait (bounded) until it has. */
export async function rollBackSwarmService(docker: Docker, serviceId: string): Promise<boolean> {
  const service = docker.services.getService(serviceId);
  const inspected = await service.inspect();
  if (inspected.isErr()) return false;
  const version = inspected.value.Version?.Index;
  const spec = inspected.value.Spec;
  if (version === undefined || !spec) return false;
  // With `rollback=previous` the engine ignores the body and restores
  // PreviousSpec; the body still has to be a valid spec.
  const rolled = await service.update({
    version,
    Name: spec.Name,
    Labels: spec.Labels,
    TaskTemplate: spec.TaskTemplate,
    Mode: spec.Mode,
    UpdateConfig: spec.UpdateConfig,
    RollbackConfig: spec.RollbackConfig,
    EndpointSpec: spec.EndpointSpec,
    rollback: "previous",
  });
  if (rolled.isErr()) return false;
  const outcome = await awaitSwarmUpdate(docker, serviceId, ROLLBACK_WAIT_MS);
  return outcome.kind === "rolled-back" || outcome.kind === "completed";
}

/** After swarm's cutover: does the edge reach the service on its port, and
 *  keep reaching it for the hold? Null when ready, else the reason. */
export async function awaitSwarmPort(
  docker: Docker,
  serviceName: string,
  plan: ReadinessPlan,
): Promise<string | null> {
  if (plan.port === null) return null;
  const started = now();
  let track = READINESS_START;
  for (;;) {
    const port = await probeEdgePort(docker, serviceName, plan.port);
    const verdict = assessReadiness(
      plan,
      {
        elapsedMs: now() - started,
        state: "running",
        exitCode: null,
        restartCount: 0,
        oomKilled: false,
        health: null,
        healthOutput: null,
        port,
      },
      track,
    );
    if (verdict.kind === "ready") return null;
    if (verdict.kind === "failed") return verdict.reason;
    track = verdict.track;
    await sleep(READY_POLL_MS);
  }
}
