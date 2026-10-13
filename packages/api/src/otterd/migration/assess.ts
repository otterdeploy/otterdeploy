/**
 * The migration preflight's judgement, as a pure function over what the
 * inventory read: which resources can be adopted in place, which only need
 * their owner switched, and what blocks the rest. Nothing here touches a
 * container; the operator approves this report before anything moves.
 */

/** A managed container as the local Docker daemon lists it. */
export interface InventoryContainer {
  id: string;
  name: string;
  image: string;
  /** created | running | paused | restarting | removing | exited | dead */
  state: string;
  labels: Readonly<Record<string, string>>;
}

export interface InventoryResource {
  resourceId: string;
  name: string;
  type: string;
  runtimeOwner: string;
  /** A deployment of this resource is pending or building. */
  deploying: boolean;
}

export type MigrationAction = "adopt" | "switch-owner" | "blocked" | "done";

export interface ResourceAssessment {
  resourceId: string;
  name: string;
  type: string;
  action: MigrationAction;
  containerId: string | null;
  image: string | null;
  blockers: string[];
  /** Expected disruption for the action. */
  disruption: string;
}

export interface Assessment {
  sessionOpen: boolean;
  installBlockers: string[];
  resources: ResourceAssessment[];
}

const RESOURCE_LABEL = "otterdeploy.resource.id";
const SWARM_LABEL = "com.docker.swarm.service.id";

function blockersOf(r: InventoryResource, mine: readonly InventoryContainer[]): string[] {
  const out: string[] = [];
  if (r.deploying) out.push("a deployment of this resource is in flight; let it finish");
  if (mine.some((c) => c.labels[SWARM_LABEL])) {
    out.push("runs as a Swarm task; Swarm services migrate in a later step");
  }
  if (mine.length > 1) {
    out.push(`${mine.length} containers (a rollout copy is in flight); wait for one to remain`);
  }
  const only = mine.length === 1 ? mine[0] : undefined;
  if (only && only.state !== "running") {
    out.push(`its container is ${only.state}; only a running container is adopted in place`);
  }
  return out;
}

function actionOf(r: InventoryResource, mine: readonly InventoryContainer[], blockers: string[]) {
  if (r.runtimeOwner === "otterd") return "done" as const;
  if (blockers.length > 0) return "blocked" as const;
  return mine.length === 0 ? ("switch-owner" as const) : ("adopt" as const);
}

const DISRUPTION: Record<MigrationAction, string> = {
  adopt: "none intended: the container keeps running; its restart policy moves to otterd",
  "switch-owner": "none: nothing runs; its next deploy goes through otterd",
  blocked: "nothing changes until the blockers clear",
  done: "already on otterd",
};

export function assess(input: {
  containers: readonly InventoryContainer[];
  resources: readonly InventoryResource[];
  /** The otterd node of this host, when enrolled. */
  hostNode: string | null;
  swarmServices: number;
  sessionOpen: boolean;
}): Assessment {
  const installBlockers: string[] = [];
  if (input.hostNode === null) {
    installBlockers.push("this host has no enrolled otterd node; install otterd on it first");
  }
  if (input.swarmServices > 0) {
    installBlockers.push(
      `${input.swarmServices} Swarm services carry otterdeploy labels; this migration covers plain containers only`,
    );
  }
  const byResource = new Map<string, InventoryContainer[]>();
  for (const c of input.containers) {
    const id = c.labels[RESOURCE_LABEL];
    if (id) byResource.set(id, [...(byResource.get(id) ?? []), c]);
  }
  const resources = input.resources.map((r): ResourceAssessment => {
    const mine = byResource.get(r.resourceId) ?? [];
    const blockers = blockersOf(r, mine);
    const action = actionOf(r, mine, blockers);
    const only = mine.length === 1 ? mine[0] : undefined;
    return {
      resourceId: r.resourceId,
      name: r.name,
      type: r.type,
      action,
      containerId: only?.id ?? null,
      image: only?.image ?? null,
      blockers,
      disruption: DISRUPTION[action],
    };
  });
  const known = new Set(input.resources.map((r) => r.resourceId));
  for (const [id, cs] of byResource) {
    if (!known.has(id)) {
      installBlockers.push(
        `containers ${cs.map((c) => c.name).join(", ")} name resource ${id}, which does not exist`,
      );
    }
  }
  return { sessionOpen: input.sessionOpen, installBlockers, resources };
}
