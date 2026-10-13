/** The planner's vocabulary: actions, typed pending reasons and policy helpers. */
import { MIN_FAILOVER_DELAY_MS, type ServiceSpec } from "@otterdeploy/otterd-proto";

import type { NodeView } from "../model";
import type { NoEligibleNode } from "../placement";

export type PendingReason =
  | NoEligibleNode
  | { code: "node-suspect"; nodeId: string }
  | { code: "node-down"; nodeId: string }
  | { code: "node-draining"; nodeId: string }
  | { code: "failover-delay"; nodeId: string; until: number }
  | { code: "partitioned"; nodeId: string; until: number }
  | { code: "fence-required"; nodeId: string }
  | { code: "fencing"; nodeId: string }
  | { code: "awaiting-stop"; grantIds: string[] }
  | { code: "adopting"; grantId: string }
  | { code: "awaiting-report"; nodeId: string }
  | { code: "rollout-paused" }
  | { code: "rollout-waiting"; until: number | null }
  | { code: "unsupported-mode"; mode: string };

export type Action =
  | { kind: "release"; grantId: string; evidenceId: string | null; reason: string }
  | {
      kind: "issue";
      resourceId: string;
      slotIndex: number;
      nodeId: string;
      exclusive: boolean;
      surge: boolean;
      specRevision: number;
      reason: string;
    }
  | { kind: "stop"; grantId: string; reason: string }
  | { kind: "adopt"; grantId: string; nodeId: string; attemptId: string; reason: string }
  | { kind: "revoke"; grantId: string; reason: string }
  | { kind: "orphan"; grantId: string; reason: string }
  | { kind: "fence"; nodeId: string; nodeEpoch: number; reason: string }
  | { kind: "pending"; resourceId: string; slotIndex: number; reason: PendingReason }
  | {
      kind: "rollout";
      resourceId: string;
      outcome: "completed" | "paused" | "rollback";
      revision: number;
    }
  | {
      kind: "upgrade-phase";
      nodeId: string;
      phase: "draining" | "upgrading" | "rejoining" | "done";
    };

/** Effective failover delay: the spec's, never below the 30 s minimum. */
export function failoverDelayMs(spec: ServiceSpec): number {
  return Math.max(spec.lifecycle.failover.delayMs, MIN_FAILOVER_DELAY_MS);
}

/** Exclusive slots and fixed host ports cannot overlap two generations. */
export function effectiveOrder(spec: ServiceSpec): "stop-first" | "start-first" {
  if (spec.lifecycle.exclusive) return "stop-first";
  const hostPort = (spec.endpoint.ports ?? []).some((p) => p.publish === "host");
  return hostPort ? "stop-first" : spec.update.order;
}

/**
 * Is this node emptying of `exclusive` work? A drain empties everything; an
 * otterd upgrade only exclusive work (boot quarantine stops exclusive grants,
 * while shared ones ride through the restart and are re-bound).
 */
export function evacuating(node: NodeView, exclusive: boolean): boolean {
  if (node.admin === "draining") return true;
  const phase = node.upgrade?.phase;
  const upgrading = phase === "draining" || phase === "upgrading" || phase === "rejoining";
  return upgrading && exclusive;
}
