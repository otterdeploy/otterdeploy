/**
 * Placement: filter by readiness, admin state, role, architecture,
 * hard constraints, allowlist, per-node cap and capacity; rank by spread,
 * preference spread and free memory with a deterministic tie-break. Hard
 * constraints never degrade: no eligible node is a typed pending reason that
 * names why every node was refused.
 */
import type { ServiceSpec } from "@otterdeploy/otterd-proto";

import { Result } from "better-result";

import { type GrantView, type NodeView, isLive, liveness } from "./model";

export type NodeRefusal =
  | "not-ready"
  | "not-active"
  | "role"
  | "architecture"
  | "constraint"
  | "allowlist"
  | "max-per-node"
  | "cpu"
  | "memory"
  | "pinned-elsewhere"
  | "excluded";

export interface NoEligibleNode {
  code: "no-eligible-node";
  /** Why each node was refused, by node id. */
  refused: Record<string, NodeRefusal>;
}

export interface Reservation {
  nanoCpus: number;
  memoryBytes: number;
}

export function reservationOf(spec: ServiceSpec): Reservation {
  const r = spec.task.resources.reservations;
  return { nanoCpus: r.nanoCpus ?? 0, memoryBytes: r.memoryBytes ?? 0 };
}

const ARCH_ALIASES: Readonly<Record<string, string>> = {
  x86_64: "amd64",
  amd64: "amd64",
  aarch64: "arm64",
  arm64: "arm64",
};
const normArch = (a: string): string => ARCH_ALIASES[a.toLowerCase()] ?? a.toLowerCase();

/** `node.id`, `node.role`, `node.arch`, `node.labels.<k>` or a bare label key. */
function attribute(node: NodeView, key: string): readonly string[] {
  if (key === "node.id") return [node.nodeId];
  if (key === "node.role") return node.roles;
  if (key === "node.arch") return [normArch(node.arch)];
  const label = key.startsWith("node.labels.") ? key.slice("node.labels.".length) : key;
  const v = node.labels[label];
  return v === undefined ? [] : [v];
}

function satisfies(node: NodeView, spec: ServiceSpec): NodeRefusal | null {
  const p = spec.task.placement;
  const roles = p.roles ?? ["worker"];
  if (!roles.some((r) => node.roles.includes(r))) return "role";
  if (p.architectures && !p.architectures.map(normArch).includes(normArch(node.arch))) {
    return "architecture";
  }
  for (const c of p.constraints ?? []) {
    const has = attribute(node, c.key).includes(c.value);
    if (c.op === "eq" ? !has : has) return "constraint";
  }
  if (p.nodes && !p.nodes.includes(node.nodeId)) return "allowlist";
  return null;
}

/** Everything reserved on a node: active, surge and orphan-possible grants (I5). */
export function usageByNode(
  grants: readonly GrantView[],
  specOf: (resourceId: string) => ServiceSpec | undefined,
): Map<string, Reservation> {
  const usage = new Map<string, Reservation>();
  for (const g of grants) {
    if (!isLive(g)) continue;
    const spec = specOf(g.resourceId);
    if (!spec) continue;
    const r = reservationOf(spec);
    const u = usage.get(g.nodeId) ?? { nanoCpus: 0, memoryBytes: 0 };
    usage.set(g.nodeId, {
      nanoCpus: u.nanoCpus + r.nanoCpus,
      memoryBytes: u.memoryBytes + r.memoryBytes,
    });
  }
  return usage;
}

export interface PlacementInput {
  spec: ServiceSpec;
  nodes: readonly NodeView[];
  /** Every live grant of every service, for capacity and spread. */
  grants: readonly GrantView[];
  usage: ReadonlyMap<string, Reservation>;
  now: number;
  /** Only this node may host the slot (data locality, global slot). */
  pinned?: string;
  /** Never these nodes (the node being replaced). */
  exclude?: readonly string[];
  /** Re-binding existing work after a node restart: a cordon does not refuse it. */
  rebind?: boolean;
}

/** Count of this resource's non-orphan live grants on each node. */
function spread(resourceId: string, grants: readonly GrantView[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const g of grants) {
    if (g.resourceId !== resourceId || !isLive(g) || g.orphan) continue;
    m.set(g.nodeId, (m.get(g.nodeId) ?? 0) + 1);
  }
  return m;
}

/** Pin, exclusion, admin state and readiness. */
function availability(node: NodeView, input: PlacementInput): NodeRefusal | null {
  if (input.pinned !== undefined && node.nodeId !== input.pinned) return "pinned-elsewhere";
  if (input.exclude?.includes(node.nodeId)) return "excluded";
  const cordonedRebind = input.rebind === true && node.admin === "cordoned";
  if (node.admin !== "active" && !cordonedRebind) return "not-active";
  if (liveness(node, input.now) !== "ready") return "not-ready";
  return null;
}

/** Per-node cap and the transactional reservation. */
function room(
  node: NodeView,
  input: PlacementInput,
  mine: ReadonlyMap<string, number>,
): NodeRefusal | null {
  const cap = input.spec.task.placement.maxReplicasPerNode;
  if (cap !== undefined && cap > 0 && (mine.get(node.nodeId) ?? 0) >= cap) return "max-per-node";
  const need = reservationOf(input.spec);
  const used = input.usage.get(node.nodeId) ?? { nanoCpus: 0, memoryBytes: 0 };
  if (used.nanoCpus + need.nanoCpus > node.allocatable.nanoCpus) return "cpu";
  if (used.memoryBytes + need.memoryBytes > node.allocatable.memoryBytes) return "memory";
  return null;
}

/** The node that should host one new grant of `spec`, or why none can. */
export function place(input: PlacementInput): Result<string, NoEligibleNode> {
  const { spec, nodes, grants, usage } = input;
  const mine = spread(spec.resourceId, grants);
  const refused: Record<string, NodeRefusal> = {};
  const eligible: NodeView[] = [];
  for (const node of nodes) {
    const why = availability(node, input) ?? satisfies(node, spec) ?? room(node, input, mine);
    if (why === null) eligible.push(node);
    else refused[node.nodeId] = why;
  }
  if (eligible.length === 0) return Result.err({ code: "no-eligible-node", refused });

  // Preference spread: fewest grants of this resource among nodes sharing the label value.
  const prefs = spec.task.placement.preferences ?? [];
  const byNode = new Map(nodes.map((n) => [n.nodeId, n]));
  const prefLoad = (node: NodeView): number[] =>
    prefs.map((p) => {
      const value = node.labels[p.label];
      let n = 0;
      for (const [id, count] of mine) {
        if (byNode.get(id)?.labels[p.label] === value) n += count;
      }
      return n;
    });
  const free = (node: NodeView): number =>
    node.allocatable.memoryBytes - (usage.get(node.nodeId)?.memoryBytes ?? 0);
  const ranked = eligible
    .map((node) => ({ node, key: [...prefLoad(node), mine.get(node.nodeId) ?? 0] }))
    .sort((a, b) => {
      for (let i = 0; i < a.key.length; i++) {
        const d = (a.key[i] ?? 0) - (b.key[i] ?? 0);
        if (d !== 0) return d;
      }
      const f = free(b.node) - free(a.node);
      if (f !== 0) return f;
      return a.node.nodeId < b.node.nodeId ? -1 : a.node.nodeId > b.node.nodeId ? 1 : 0;
    });
  const best = ranked[0];
  return best ? Result.ok(best.node.nodeId) : Result.err({ code: "no-eligible-node", refused });
}

/** Nodes a global service should have a slot on (cordon and drain add none). */
export function globalNodes(spec: ServiceSpec, nodes: readonly NodeView[]): readonly NodeView[] {
  return nodes.filter((n) => n.admin === "active" && satisfies(n, spec) === null);
}
