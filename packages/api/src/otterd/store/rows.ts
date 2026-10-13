/**
 * Rows to the scheduler's views, and the one function that decides which
 * stored evidence retires which grant. The snapshot and the release
 * transaction both call it, so the planner and the store cannot disagree.
 */
import type { otterdEvidence, otterdFence, otterdGrant } from "@otterdeploy/db/schema/otterd";

import {
  type GrantState,
  type GrantView,
  type Retirement,
  barrierRetires,
} from "@otterdeploy/otterd-cp";
import { barrierEvidence } from "@otterdeploy/otterd-proto";

export type GrantRow = typeof otterdGrant.$inferSelect;
export type EvidenceRow = typeof otterdEvidence.$inferSelect;
export type FenceRow = typeof otterdFence.$inferSelect;

const GRANT_STATES: readonly GrantState[] = [
  "prepared",
  "granted",
  "starting",
  "running",
  "stopping",
  "released",
  "unknown",
];

/** A stored state the code does not know is treated as Unknown: it keeps its barrier. */
export function grantStateOf(value: string): GrantState {
  return GRANT_STATES.find((s) => s === value) ?? "unknown";
}

export function grantView(g: GrantRow): GrantView {
  return {
    grantId: g.grantId,
    resourceId: g.resourceId,
    slotIndex: g.slotIndex,
    generation: g.generation,
    nodeId: g.nodeId,
    nodeEpoch: g.nodeEpoch,
    incarnation: g.incarnation,
    exclusive: g.exclusive,
    specRevision: g.specRevision,
    state: grantStateOf(g.state),
    orphan: g.orphan,
    surge: g.surge,
    revoked: g.revokedAt !== null,
    stopRequested: g.stopRequestedAt !== null,
    sentAt: g.sentAt,
    runningSince: g.runningSince,
    failed: g.failed,
  };
}

/**
 * The positive retirement stored for a grant, if any: its own stop
 * certificate, or a barrier of its node epoch from a fence that was requested
 * after the grant's revocation and observed after the grant was sent.
 */
export function retirementOf(
  g: GrantRow,
  evidence: readonly EvidenceRow[],
  fences: readonly FenceRow[],
): Retirement | null {
  const cert = evidence.find((e) => e.kind === "stop-certificate" && e.grantId === g.grantId);
  if (cert) return { grantId: g.grantId, evidenceId: cert.evidenceId, kind: "stop-certificate" };
  for (const f of fences) {
    if (f.state !== "succeeded" || f.nodeId !== g.nodeId || f.nodeEpoch !== g.nodeEpoch) continue;
    if (g.revokedAt === null || g.revokedAt > f.revokedAt) continue;
    const ev = evidence.find((e) => e.evidenceId === f.evidenceId);
    const barrier = barrierEvidence.safeParse(ev?.document);
    if (!ev || !barrier.success) continue;
    const grant = {
      nodeEpoch: g.nodeEpoch,
      sentAt: g.sentAt,
      revoked: true,
      revokedAt: g.revokedAt,
    };
    if (!barrierRetires(barrier.data, grant)) continue;
    const kind = barrier.data.method === "manual-fence" ? "manual-fence" : "provider-power-off";
    return { grantId: g.grantId, evidenceId: ev.evidenceId, kind };
  }
  return null;
}
