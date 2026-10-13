/**
 * One reconcile pass's working state: the snapshot plus every change the pass
 * has decided so far, so later slots see earlier placements' reservations.
 */
import type { ServiceSpec } from "@otterdeploy/otterd-proto";

import type { Action, PendingReason } from "./types";

import {
  type GrantView,
  type Liveness,
  type NodeView,
  type Retirement,
  type ServiceView,
  type Snapshot,
  liveness,
} from "../model";
import { type Reservation, place, reservationOf, usageByNode } from "../placement";

export interface IssueOptions {
  surge: boolean;
  pinned?: string;
  exclude?: readonly string[];
  reason: string;
  /** Do not record a pending reason when placement fails. */
  quiet?: boolean;
  /** Re-binding existing work after a node restart. */
  rebind?: boolean;
}

export class Pass {
  readonly actions: Action[] = [];
  readonly nodes: ReadonlyMap<string, NodeView>;
  readonly live: ReadonlyMap<string, Liveness>;
  readonly retirements: ReadonlyMap<string, Retirement>;
  /** Grants as this pass changes them, for capacity and spread. */
  readonly working: GrantView[];
  readonly usage: Map<string, Reservation>;
  readonly specs: ReadonlyMap<string, ServiceSpec>;
  private readonly fenced = new Set<string>();
  private synthetic = 0;

  constructor(readonly s: Snapshot) {
    this.nodes = new Map(s.nodes.map((n) => [n.nodeId, n]));
    this.live = new Map(s.nodes.map((n) => [n.nodeId, liveness(n, s.now)]));
    this.retirements = new Map(s.retirements.map((r) => [r.grantId, r]));
    this.working = s.grants.filter((g) => g.state !== "released").map((g) => ({ ...g }));
    this.specs = new Map(s.services.map((v) => [v.resourceId, v.spec]));
    this.usage = usageByNode(this.working, (id) => this.specs.get(id));
  }

  liveness(nodeId: string): Liveness {
    return this.live.get(nodeId) ?? "down";
  }

  /** The node restarted since this grant was issued: boot quarantine stops it. */
  restarted(g: GrantView): boolean {
    const n = this.nodes.get(g.nodeId);
    return (
      n !== undefined && n.connected && n.incarnation !== null && n.incarnation !== g.incarnation
    );
  }

  pending(svc: ServiceView, slotIndex: number, reason: PendingReason): void {
    this.actions.push({ kind: "pending", resourceId: svc.resourceId, slotIndex, reason });
  }

  stop(g: GrantView, reason: string): void {
    if (g.stopRequested) return;
    g.stopRequested = true;
    g.revoked = true;
    this.actions.push({ kind: "stop", grantId: g.grantId, reason });
  }

  /** Release a grant the admission rules allow to release; frees its reservation. */
  release(g: GrantView, r: Retirement | null): void {
    g.state = "released";
    this.actions.push({
      kind: "release",
      grantId: g.grantId,
      evidenceId: r?.evidenceId ?? null,
      reason: r ? `positive retirement: ${r.kind}` : "never left the control plane",
    });
    const spec = this.specs.get(g.resourceId);
    const u = this.usage.get(g.nodeId);
    if (!spec || !u) return;
    const res = reservationOf(spec);
    this.usage.set(g.nodeId, {
      nanoCpus: u.nanoCpus - res.nanoCpus,
      memoryBytes: u.memoryBytes - res.memoryBytes,
    });
  }

  revoke(g: GrantView, reason: string): void {
    if (g.revoked) return;
    g.revoked = true;
    this.actions.push({ kind: "revoke", grantId: g.grantId, reason });
  }

  fence(node: NodeView, reason: string): void {
    if (this.fenced.has(node.nodeId)) return;
    this.fenced.add(node.nodeId);
    this.actions.push({ kind: "fence", nodeId: node.nodeId, nodeEpoch: node.nodeEpoch, reason });
  }

  issue(svc: ServiceView, slotIndex: number, opts: IssueOptions): boolean {
    const placed = place({
      spec: svc.spec,
      nodes: this.s.nodes,
      grants: this.working,
      usage: this.usage,
      now: this.s.now,
      ...(opts.pinned === undefined ? {} : { pinned: opts.pinned }),
      ...(opts.exclude === undefined ? {} : { exclude: opts.exclude }),
      ...(opts.rebind ? { rebind: true } : {}),
    });
    if (placed.isErr()) {
      if (!opts.quiet) this.pending(svc, slotIndex, placed.error);
      return false;
    }
    const nodeId = placed.value;
    const node = this.nodes.get(nodeId);
    this.actions.push({
      kind: "issue",
      resourceId: svc.resourceId,
      slotIndex,
      nodeId,
      exclusive: svc.spec.lifecycle.exclusive,
      surge: opts.surge,
      specRevision: svc.revision,
      reason: opts.reason,
    });
    const r = reservationOf(svc.spec);
    const u = this.usage.get(nodeId) ?? { nanoCpus: 0, memoryBytes: 0 };
    this.usage.set(nodeId, {
      nanoCpus: u.nanoCpus + r.nanoCpus,
      memoryBytes: u.memoryBytes + r.memoryBytes,
    });
    this.working.push({
      grantId: `planned-${this.synthetic++}`,
      resourceId: svc.resourceId,
      slotIndex,
      generation: -1,
      nodeId,
      nodeEpoch: node?.nodeEpoch ?? 0,
      incarnation: node?.incarnation ?? "",
      exclusive: svc.spec.lifecycle.exclusive,
      specRevision: svc.revision,
      state: "prepared",
      orphan: false,
      surge: opts.surge,
      revoked: false,
      stopRequested: false,
      sentAt: null,
      runningSince: null,
      failed: false,
      held: null,
    });
    return true;
  }

  /**
   * Re-bind the attempt a restarted node held, on the same node and the same
   * container, under a fresh grant of a higher generation. The old grant
   * hands over in the same transaction; there is never a second process.
   */
  adopt(g: GrantView, attemptId: string, reason: string): void {
    const node = this.nodes.get(g.nodeId);
    this.actions.push({ kind: "adopt", grantId: g.grantId, nodeId: g.nodeId, attemptId, reason });
    g.state = "released";
    this.working.push({
      ...g,
      grantId: `planned-${this.synthetic++}`,
      generation: -1,
      incarnation: node?.incarnation ?? "",
      state: "prepared",
      sentAt: null,
      held: null,
    });
  }
}
