/**
 * The end of a swarm service update: swarm's own verdict, then the edge port
 * probe for a service without a healthcheck (see update-watch.ts), turned into
 * the runtime status the deploy reports. Split out of service.ts (line cap).
 */
import type { Docker } from "@otterdeploy/docker";

import type { SwarmServiceRuntime, SwarmServiceSpec } from "./service";

import { readinessPlan, readinessPort } from "../runtime/readiness";
import { inspectSwarmService } from "./internals";
import { recentTaskFailure } from "./task-status";
import { awaitSwarmPort, awaitSwarmUpdate, rollBackSwarmService } from "./update-watch";

async function failureReason(docker: Docker, serviceName: string, fallback: string | null) {
  const tasks = await docker.tasks.list({ filters: { service: [serviceName] } });
  const fromTask = tasks.isOk() ? recentTaskFailure(tasks.value) : null;
  return fromTask ?? fallback ?? "its task failed";
}

async function failed(
  docker: Docker,
  spec: SwarmServiceSpec,
  networkName: string,
  reason: string,
  rolledBack: boolean,
): Promise<SwarmServiceRuntime> {
  const runtime = await inspectSwarmService(docker, spec.serviceName, networkName);
  return {
    serviceId: runtime?.serviceId ?? null,
    serviceName: spec.serviceName,
    networkName,
    status: "error",
    health: runtime?.health ?? null,
    errorMessage: rolledBack
      ? `new version ${reason}; the previous version keeps serving`
      : `new version ${reason}`,
    rolledBack,
  };
}

/** Wait for the update to really end and report it (never "running" for a
 *  version swarm rolled back, or one nothing can reach). */
export async function settleSwarmUpdate(
  docker: Docker,
  spec: SwarmServiceSpec,
  serviceId: string,
  networkName: string,
): Promise<SwarmServiceRuntime> {
  const plan = readinessPlan({
    healthcheck: spec.healthcheck ?? null,
    port: readinessPort(spec.ports),
  });
  const outcome = await awaitSwarmUpdate(docker, serviceId, plan.timeoutMs + plan.holdMs);
  if (outcome.kind === "rolled-back") {
    const why = await failureReason(docker, spec.serviceName, outcome.message);
    return failed(docker, spec, networkName, `failed and swarm rolled it back: ${why}`, true);
  }
  if (outcome.kind === "paused") {
    const why = await failureReason(docker, spec.serviceName, outcome.message);
    return failed(docker, spec, networkName, `failed and the rollout is paused: ${why}`, false);
  }
  const reason =
    outcome.kind === "updating"
      ? `never became ready within ${Math.round(plan.timeoutMs / 1000)}s`
      : spec.healthcheck
        ? null
        : await awaitSwarmPort(docker, spec.serviceName, plan);
  if (reason === null) {
    const runtime = await inspectSwarmService(docker, spec.serviceName, networkName);
    if (runtime) return runtime;
    return failed(docker, spec, networkName, "disappeared after the update", false);
  }
  const restored = await rollBackSwarmService(docker, serviceId);
  return failed(docker, spec, networkName, reason, restored);
}
