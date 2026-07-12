/**
 * Pure helpers behind the Scaling settings card — patch construction (with
 * the pause-preservation guard), cluster-fit math against registered server
 * capacity, and the per-node placement grouping. Kept free of React/orpc so
 * they unit-test like healthcheck-http.ts.
 */

// Contract bounds for the limit inputs. CPU is vCPU cores; memory is MB.
export const CPU_LIMIT_MIN = 0.1;
export const CPU_LIMIT_MAX = 8;
export const MEMORY_LIMIT_MIN_MB = 64;
export const MEMORY_LIMIT_MAX_MB = 16_384;

export interface StoredScaling {
  replicas: number;
  /** Non-null = paused; holds the count resume restores. */
  pausedReplicas: number | null;
  cpuLimit: number | null;
  memoryLimitMb: number | null;
}

export interface ScalingFormValues {
  replicas: number;
  cpuLimit: number | null;
  memoryLimitMb: number | null;
}

/**
 * The replica count the operator actually wants. While paused the stored
 * `replicas` is 0 (that's how pause stops the containers), so the form seeds
 * from the remembered `pausedReplicas` instead.
 */
export function desiredReplicas(
  stored: Pick<StoredScaling, "replicas" | "pausedReplicas">,
): number {
  return stored.pausedReplicas ?? stored.replicas;
}

export function initialScalingForm(stored: StoredScaling): ScalingFormValues {
  return {
    replicas: Math.max(desiredReplicas(stored), 1),
    cpuLimit: stored.cpuLimit,
    memoryLimitMb: stored.memoryLimitMb,
  };
}

export function isValidCpuLimit(v: number | null): boolean {
  return v === null || (Number.isFinite(v) && v >= CPU_LIMIT_MIN && v <= CPU_LIMIT_MAX);
}

export function isValidMemoryLimitMb(v: number | null): boolean {
  return (
    v === null || (Number.isInteger(v) && v >= MEMORY_LIMIT_MIN_MB && v <= MEMORY_LIMIT_MAX_MB)
  );
}

export interface ScalingPatch {
  replicas?: number;
  resources?: { cpuLimit: number | null; memoryLimitMb: number | null };
}

/**
 * Build the minimal `service.update` patch — or null when nothing changed.
 *
 * Pause guard: the server clears `pausedReplicas` whenever a patch carries an
 * explicit `replicas` value (whoever sets replicas is stating desired state).
 * So `replicas` is only included when the operator actually moved the stepper
 * away from the desired count — a limits-only save while paused must NOT
 * resume the service. Conversely, an explicit replica edit while paused
 * deliberately resumes with the new count; the card's copy says so.
 */
export function buildScalingPatch(
  stored: StoredScaling,
  form: ScalingFormValues,
): ScalingPatch | null {
  const patch: ScalingPatch = {};
  if (form.replicas !== desiredReplicas(stored)) {
    patch.replicas = form.replicas;
  }
  if (form.cpuLimit !== stored.cpuLimit || form.memoryLimitMb !== stored.memoryLimitMb) {
    // Explicit nulls clear a stored limit ("no limit"); an omitted resources
    // object would be patch-semantics "leave alone" server-side.
    patch.resources = { cpuLimit: form.cpuLimit, memoryLimitMb: form.memoryLimitMb };
  }
  return patch.replicas === undefined && patch.resources === undefined ? null : patch;
}

/** What saving this patch does to the service's lifecycle. */
export function saveConsequence(
  stored: Pick<StoredScaling, "pausedReplicas">,
  patch: ScalingPatch,
): "redeploy" | "resume" | "redeploy-paused" {
  if (stored.pausedReplicas === null) return "redeploy";
  // Paused: an explicit replicas value clears the pause marker server-side.
  return patch.replicas !== undefined ? "resume" : "redeploy-paused";
}

// ---------------------------------------------------------------------------
// Cluster fit — requested (replicas × limits) vs registered server capacity.
// ---------------------------------------------------------------------------

export interface CapacityNode {
  /** Daemon-reported totals; 0 = not yet reported (join-flow default). */
  cpuTotal: number;
  memTotalGb: number;
}

export type ClusterFit =
  | { known: false }
  | {
      known: true;
      fits: boolean;
      /** Excess beyond capacity per dimension; 0 when that dimension fits
       *  (or has no limit / no reported capacity to compare against). */
      cpuExcessVcpu: number;
      memExcessMb: number;
    };

/**
 * Compare replicas × per-replica limits against the summed capacity of the
 * registered servers. Honest about the unknowns: no limits set, no servers,
 * or capacity never reported (0 totals) all yield `known: false` so the card
 * can omit the line instead of asserting a fit it can't verify.
 */
export function computeClusterFit(input: {
  replicas: number;
  cpuLimit: number | null;
  memoryLimitMb: number | null;
  nodes: CapacityNode[];
}): ClusterFit {
  const { replicas, cpuLimit, memoryLimitMb, nodes } = input;
  if (cpuLimit === null && memoryLimitMb === null) return { known: false };

  const cpuCapacity = nodes.reduce((sum, n) => sum + n.cpuTotal, 0);
  const memCapacityMb = nodes.reduce((sum, n) => sum + n.memTotalGb * 1024, 0);

  const cpuComparable = cpuLimit !== null && cpuCapacity > 0;
  const memComparable = memoryLimitMb !== null && memCapacityMb > 0;
  if (!cpuComparable && !memComparable) return { known: false };

  const cpuExcessVcpu = cpuComparable
    ? Math.max(0, roundVcpu(cpuLimit * replicas - cpuCapacity))
    : 0;
  const memExcessMb = memComparable ? Math.max(0, memoryLimitMb * replicas - memCapacityMb) : 0;

  return {
    known: true,
    fits: cpuExcessVcpu === 0 && memExcessMb === 0,
    cpuExcessVcpu,
    memExcessMb,
  };
}

/** One quiet line for the fit result; null when unknown (omit the line). */
export function clusterFitMessage(fit: ClusterFit): string | null {
  if (!fit.known) return null;
  if (fit.fits) return "Fits available capacity";
  const parts: string[] = [];
  if (fit.cpuExcessVcpu > 0) parts.push(`cluster CPU by ${formatCpu(fit.cpuExcessVcpu)}`);
  if (fit.memExcessMb > 0) parts.push(`cluster memory by ${formatMemoryMb(fit.memExcessMb)}`);
  return `Exceeds ${parts.join(" and ")}`;
}

// Kill float dust from 0.1-step arithmetic (0.30000000000000004 vCPU).
function roundVcpu(v: number): number {
  return Math.round(v * 100) / 100;
}

export function formatCpu(vcpu: number): string {
  return `${roundVcpu(vcpu)} vCPU`;
}

export function formatMemoryMb(mb: number): string {
  if (mb >= 1024) {
    const gb = mb / 1024;
    return `${Number.isInteger(gb) ? gb : gb.toFixed(1)} GB`;
  }
  return `${mb} MB`;
}

// ---------------------------------------------------------------------------
// Per-node placement readout (swarm tasks grouped by node hostname).
// ---------------------------------------------------------------------------

export interface PlacementTask {
  serviceId: string;
  nodeId: string;
  state: string;
}

export interface PlacementNode {
  id: string;
  hostname: string;
}

export interface NodePlacement {
  hostname: string;
  running: number;
}

/**
 * Group this service's RUNNING tasks by node hostname. Nodes without a task
 * are omitted (the card lists where replicas actually run, not the whole
 * cluster). Tasks on nodes missing from the directory fold into an
 * "(unknown node)" bucket rather than being silently dropped.
 */
export function groupRunningTasksByNode(
  tasks: PlacementTask[],
  nodes: PlacementNode[],
  swarmServiceId: string,
): NodePlacement[] {
  const hostnameById = new Map(nodes.map((n) => [n.id, n.hostname]));
  const counts = new Map<string, number>();
  for (const t of tasks) {
    if (t.serviceId !== swarmServiceId || t.state !== "running") continue;
    const hostname = hostnameById.get(t.nodeId) ?? "(unknown node)";
    counts.set(hostname, (counts.get(hostname) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([hostname, running]) => ({ hostname, running }))
    .sort((a, b) => a.hostname.localeCompare(b.hostname));
}
