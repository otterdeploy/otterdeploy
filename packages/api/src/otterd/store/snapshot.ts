/**
 * The scheduler's snapshot, read in one repeatable-read transaction: nodes
 * with their session and fence state, services at their target revision,
 * every grant that is not Released, and the retirements stored evidence
 * proves (rows.ts `retirementOf`, the same function the release uses).
 */
import { db } from "@otterdeploy/db";
import {
  otterdEvidence,
  otterdFence,
  otterdGrant,
  otterdNode,
  otterdService,
  otterdServiceRevision,
} from "@otterdeploy/db/schema/otterd";
import {
  type FenceAdapterName,
  type NodeAdminState,
  type NodeView,
  type Retirement,
  type ServiceView,
  type Snapshot,
  type UpgradeView,
} from "@otterdeploy/otterd-cp";
import { nodeRole, serviceSpec } from "@otterdeploy/otterd-proto";
import { Result } from "better-result";
import { and, eq, ne } from "drizzle-orm";

import { type StoreFailure, toStoreFailure } from "./errors";
import { grantView, retirementOf } from "./rows";

type NodeRow = typeof otterdNode.$inferSelect;

const ADMIN: readonly NodeAdminState[] = ["active", "cordoned", "draining", "retired"];
const PHASES: readonly UpgradeView["phase"][] = [
  "queued",
  "draining",
  "upgrading",
  "rejoining",
  "done",
];
const ADAPTERS: readonly FenceAdapterName[] = ["hetzner", "manual"];

function upgradeOf(n: NodeRow): UpgradeView | null {
  const phase = PHASES.find((p) => p === n.upgradePhase);
  if (!phase) return null;
  return { phase, fromIncarnation: n.upgradeFromIncarnation, since: n.upgradeSince ?? n.updatedAt };
}

function nodeView(n: NodeRow, fencing: boolean): NodeView {
  const adapter = ADAPTERS.find((a) => a === n.fenceAdapter);
  return {
    nodeId: n.nodeId,
    nodeEpoch: n.nodeEpoch,
    incarnation: n.sessionId ? n.incarnation : null,
    // An unknown admin state places nothing: treat it as cordoned.
    admin: ADMIN.find((a) => a === n.admin) ?? "cordoned",
    roles: n.roles.flatMap((r) => {
      const role = nodeRole.safeParse(r);
      return role.success ? [role.data] : [];
    }),
    labels: n.labels,
    arch: n.arch,
    allocatable: { nanoCpus: n.allocatableNanoCpus, memoryBytes: n.allocatableMemoryBytes },
    lastEvidenceAt: n.lastEvidenceAt,
    connected: n.sessionId !== null,
    reported: n.sessionId !== null && n.reportedSession === n.sessionId,
    fence: adapter ? { adapter, enabled: n.fenceEnabled } : null,
    fencing,
    peerFreshUntil: n.peerFreshUntil,
    ordinal: n.ordinal,
    upgrade: upgradeOf(n),
  };
}

export function loadSnapshot(now: number): Promise<Result<Snapshot, StoreFailure>> {
  return Result.tryPromise({
    catch: toStoreFailure,
    try: () =>
      db.transaction(
        async (tx) => {
          const nodes = await tx.select().from(otterdNode).where(ne(otterdNode.admin, "retired"));
          const fences = await tx.select().from(otterdFence);
          const evidence = await tx.select().from(otterdEvidence);
          const grants = await tx
            .select()
            .from(otterdGrant)
            .where(ne(otterdGrant.state, "released"));
          const rows = await tx
            .select({ svc: otterdService, rev: otterdServiceRevision })
            .from(otterdService)
            .innerJoin(
              otterdServiceRevision,
              and(
                eq(otterdServiceRevision.resourceId, otterdService.resourceId),
                eq(otterdServiceRevision.revision, otterdService.revision),
              ),
            );
          const services: ServiceView[] = rows.flatMap(({ svc, rev }) => {
            const spec = serviceSpec.safeParse(rev.spec);
            if (!spec.success) return [];
            return [
              {
                resourceId: svc.resourceId,
                revision: svc.revision,
                spec: spec.data,
                paused: svc.paused,
                stableRevision: svc.stableRevision,
                lastSlotUpdatedAt: svc.lastSlotUpdatedAt,
                rolloutPaused: svc.rolloutPaused,
                homeNode: svc.homeNode,
              },
            ];
          });
          const inFlight = new Set(
            fences.filter((f) => f.state === "requested").map((f) => `${f.nodeId}@${f.nodeEpoch}`),
          );
          const retirements: Retirement[] = grants.flatMap((g) => {
            const r = retirementOf(g, evidence, fences);
            return r ? [r] : [];
          });
          return {
            now,
            nodes: nodes.map((n) => nodeView(n, inFlight.has(`${n.nodeId}@${n.nodeEpoch}`))),
            services,
            grants: grants.map(grantView),
            retirements,
          };
        },
        { isolationLevel: "repeatable read", accessMode: "read only" },
      ),
  });
}
