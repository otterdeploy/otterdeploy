/**
 * Compose-stack deploy orchestration. A `type: compose` resource fans out to N
 * swarm services on the project overlay network — this applies/reconciles/
 * removes them as one unit. Every sub-service carries the compose resource's id
 * as the `otterdeploy.resource.id` label (set by `buildServiceSpec`), so we
 * reconcile the live set by listing on that label — no extra labelling needed.
 *
 * Each spec is produced by `stack/compose/to-spec.ts#composeServiceToSpec`. We
 * reuse `updateSwarmService` (create-or-update) per service, so the entire
 * single-service deploy primitive is reused verbatim. See docs/designs/compose.md.
 */
import { Docker } from "@otterdeploy/docker";
import type { RequestLogger } from "evlog";

import { asStepLogger } from "../lib/logger";
import {
  destroySwarmService,
  updateSwarmService,
  type SwarmServiceRuntime,
  type SwarmServiceSpec,
} from "./service";

export interface ComposeStackRuntime {
  services: SwarmServiceRuntime[];
  status: "running" | "starting" | "partial" | "error";
}

const stackLabel = (resourceId: string) =>
  `otterdeploy.resource.id=${resourceId}`;

/**
 * Apply the desired set of service specs, then prune any swarm services owned
 * by this stack that the (possibly edited) compose file no longer declares.
 */
export async function deployComposeStack(
  input: {
    resourceId: string;
    projectSlug: string;
    specs: SwarmServiceSpec[];
  },
  rlog?: RequestLogger,
): Promise<ComposeStackRuntime> {
  const log = asStepLogger(rlog);

  const runtimes: SwarmServiceRuntime[] = [];
  for (const spec of input.specs) {
    runtimes.push(await updateSwarmService(spec, rlog));
  }

  // Reconcile removals: services we own but no longer want.
  const desired = new Set(input.specs.map((s) => s.serviceName));
  const owned = await listStackServiceNames(input.resourceId);
  for (const name of owned) {
    if (desired.has(name)) continue;
    log.info({ swarm: { step: "compose-prune-service", service: name } });
    await destroySwarmService({ serviceName: name }, rlog);
  }

  return aggregate(runtimes);
}

/** Tear the whole stack down — every swarm service owned by this resource. */
export async function removeComposeStack(
  input: { resourceId: string },
  rlog?: RequestLogger,
): Promise<void> {
  const log = asStepLogger(rlog);
  const names = await listStackServiceNames(input.resourceId);
  for (const name of names) {
    log.info({ swarm: { step: "compose-remove-service", service: name } });
    await destroySwarmService({ serviceName: name }, rlog);
  }
}

/** Current runtime status of every live service owned by the stack. */
export async function inspectComposeStack(input: {
  resourceId: string;
}): Promise<ComposeStackRuntime> {
  const docker = Docker.fromEnv();
  const res = await docker.services.list({
    filters: { label: [stackLabel(input.resourceId)] },
  });
  docker.destroy();
  if (res.isErr()) throw res.error;
  const services: SwarmServiceRuntime[] = res.value.map((s) => ({
    serviceId: s.ID ?? null,
    serviceName: s.Spec?.Name ?? "",
    networkName: "",
    // List doesn't carry task health; the deployments/runtime queries enrich
    // per-service. Surface "running" when the service object exists.
    status: "running",
    health: null,
  }));
  return aggregate(services);
}

async function listStackServiceNames(resourceId: string): Promise<string[]> {
  const docker = Docker.fromEnv();
  const res = await docker.services.list({
    filters: { label: [stackLabel(resourceId)] },
  });
  docker.destroy();
  if (res.isErr()) throw res.error;
  return res.value
    .map((s) => s.Spec?.Name)
    .filter((n): n is string => typeof n === "string" && n.length > 0);
}

function aggregate(runtimes: SwarmServiceRuntime[]): ComposeStackRuntime {
  if (runtimes.length === 0) return { services: [], status: "error" };
  if (runtimes.every((r) => r.status === "running")) {
    return { services: runtimes, status: "running" };
  }
  if (runtimes.some((r) => r.status === "error" || r.status === "missing")) {
    return { services: runtimes, status: "error" };
  }
  if (runtimes.some((r) => r.status === "starting")) {
    return { services: runtimes, status: "starting" };
  }
  return { services: runtimes, status: "partial" };
}
