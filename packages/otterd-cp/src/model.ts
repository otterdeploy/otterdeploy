/**
 * The control plane's view of the fleet, as the scheduler reads it.
 *
 * Everything here is a plain snapshot: the store builds it from Postgres and
 * the hub's live sessions, the planner turns it into actions, and nothing in
 * this package reads a clock or a database. Times are epoch milliseconds
 * passed in by the caller.
 */
import type { NodeRole, ServiceSpec } from "@otterdeploy/otterd-proto";

/** Node evidence classification defaults. */
export const TIMING = {
  /** No fresh direct evidence for this long: suspect (no new placements). */
  suspectAfterMs: 15_000,
  /** No fresh direct evidence for this long: down. A classification, never proof of death. */
  downAfterMs: 30_000,
} as const;

/** Administrative node state. Liveness is separate and derived from evidence. */
export type NodeAdminState = "active" | "cordoned" | "draining" | "retired";

export type FenceAdapterName = "hetzner" | "manual";

export interface NodeView {
  nodeId: string;
  nodeEpoch: number;
  /** Incarnation of the live control session, or null while none is up. */
  incarnation: string | null;
  admin: NodeAdminState;
  roles: readonly NodeRole[];
  labels: Readonly<Record<string, string>>;
  arch: string;
  allocatable: { nanoCpus: number; memoryBytes: number };
  /** Last authenticated frame from this node, on any session; null if never. */
  lastEvidenceAt: number | null;
  /** A control session is established now. */
  connected: boolean;
  /**
   * The live session has delivered its first slot report. Until then a
   * restarted node's earlier grants are not judged: they may be held.
   */
  reported: boolean;
  /** Automatic whole-node fencing, off unless an install admin enabled it. */
  fence: { adapter: FenceAdapterName; enabled: boolean } | null;
  /** A fence of the current node epoch is under way (the store's record). */
  fencing: boolean;
  /** Fresh authenticated peer evidence that the node is alive (partitioned, not dead). */
  peerFreshUntil: number | null;
  /** Enrollment order; the index of this node's global slot. */
  ordinal: number;
  /** This node's place in a rolling otterd upgrade, if it is in one. */
  upgrade: UpgradeView | null;
}

/**
 * A node's otterd upgrade. An otterd restart is a new incarnation: boot
 * quarantine stops and certifies every exclusive grant on the node, while
 * shared grants keep running and need a fresh grant. So an upgrade runs one
 * node at a time: cordon and drain exclusive work (move what can move, stop
 * what is pinned), upgrade, wait for the new incarnation, then re-issue the
 * pinned exclusive slots and re-bind the shared ones.
 */
export interface UpgradeView {
  phase: "queued" | "draining" | "upgrading" | "rejoining" | "done";
  /** Incarnation of the session the upgrade was sent on. */
  fromIncarnation: string | null;
  /** When the current phase began. */
  since: number;
}

export type Liveness = "ready" | "suspect" | "down";

/**
 * Ready needs a live session and fresh evidence. A node without a session is
 * at least suspect, and down only once its evidence is `downAfterMs` old: a
 * dropped socket alone never makes a node down.
 */
export function liveness(node: NodeView, now: number): Liveness {
  if (node.lastEvidenceAt === null) return node.connected ? "suspect" : "down";
  const age = now - node.lastEvidenceAt;
  if (age >= TIMING.downAfterMs) return "down";
  if (!node.connected || age >= TIMING.suspectAfterMs) return "suspect";
  return "ready";
}

/** Control-plane grant states. `Unknown` keeps its ownership barrier. */
export type GrantState =
  | "prepared"
  | "granted"
  | "starting"
  | "running"
  | "stopping"
  | "released"
  | "unknown";

export interface GrantView {
  grantId: string;
  resourceId: string;
  slotIndex: number;
  generation: number;
  nodeId: string;
  nodeEpoch: number;
  incarnation: string;
  exclusive: boolean;
  specRevision: number;
  state: GrantState;
  /** Superseded shared copy that may still run: counted, never released on silence. */
  orphan: boolean;
  /** Start-first candidate beside the slot's incumbent. */
  surge: boolean;
  /** Revocation intent committed: no lease renewal, no restart. */
  revoked: boolean;
  /** A stop was requested and not yet answered with a certificate. */
  stopRequested: boolean;
  /** When the grant left the control plane; null while Prepared. */
  sentAt: number | null;
  /** Its newest attempt has been running continuously since (node reports). */
  runningSince: number | null;
  /** Its newest attempt exited or became unknown and nothing replaced it. */
  failed: boolean;
  /**
   * The attempt a restarted node kept for this grant (only an unrevoked
   * exclusive grant of an earlier process is held, paused meanwhile) and asks
   * the control plane to confirm; null if none. From the node's slot report.
   */
  held: HeldAttempt | null;
}

export interface HeldAttempt {
  attemptId: string;
  paused: boolean;
}

/** Positive retirement the store has verified for a grant. */
export interface Retirement {
  grantId: string;
  evidenceId: string;
  kind: "stop-certificate" | "provider-power-off" | "manual-fence";
}

export interface ServiceView {
  resourceId: string;
  /** The revision every slot should run. */
  revision: number;
  spec: ServiceSpec;
  /** Scaled to zero or paused: every grant stops, volumes stay. */
  paused: boolean;
  /** Last revision whose rollout completed, for a rollback. */
  stableRevision: number | null;
  /** When the last updated slot became healthy, for `update.delayMs`. */
  lastSlotUpdatedAt: number | null;
  /** The rollout of `revision` was paused by its failure policy. */
  rolloutPaused: boolean;
  /**
   * The node holding a `stay` service's data, set at its first placement.
   * A `stay` slot is only ever placed there again.
   */
  homeNode: string | null;
}

export interface Snapshot {
  now: number;
  nodes: readonly NodeView[];
  services: readonly ServiceView[];
  /** Every grant that is not Released. */
  grants: readonly GrantView[];
  retirements: readonly Retirement[];
}

export const isLive = (g: GrantView): boolean => g.state !== "released";
