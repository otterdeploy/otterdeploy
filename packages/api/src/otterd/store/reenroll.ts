/**
 * Re-enrolling a fenced node at a new epoch. A fence retires the node's
 * grants of its current epoch; before that node may run anything again it
 * must join under a new epoch, so nothing of the old one can be reused.
 *
 * `beginReenroll` requires a succeeded fence of the current epoch and no
 * grant of it left unreleased, appends the node at the new epoch to the
 * anchor first, then raises the epoch and keeps the old one as the
 * `recovery_epoch`: the node, still at the old epoch after its controlled
 * power-on, connects once more, retires its unresolved Engine requests with
 * the fence's barrier evidence and accepts the new certificate
 * (`finishReenroll`), then reconnects at the new epoch.
 */
import { db } from "@otterdeploy/db";
import {
  otterdAuthority,
  otterdEvidence,
  otterdFence,
  otterdGrant,
  otterdNode,
} from "@otterdeploy/db/schema/otterd";
import { type BarrierEvidence, type Signer, signEnrollCertificate } from "@otterdeploy/otterd-cp";
import {
  type EnrollCertificate,
  type SignedEnvelope,
  barrierEvidence,
  hostBinding,
  nodeRole,
  signedEnvelope,
} from "@otterdeploy/otterd-proto";
import { Result } from "better-result";
import { and, desc, eq, inArray, ne } from "drizzle-orm";

import type { EnrollOutcome, NodeRecord, ToolError } from "../tools";

import { type StoreFailure, refusal, run, toStoreFailure } from "./errors";
import { journal } from "./journal";

export interface ReenrollConfig {
  signer: Signer;
  controlUrl: string;
  recoveryKey: string;
  anchor: ((node: NodeRecord) => Promise<Result<EnrollOutcome, ToolError>>) | null;
}

export function beginReenroll(
  cfg: ReenrollConfig,
  nodeId: string,
  now: number,
): Promise<Result<{ nodeEpoch: number }, StoreFailure | ToolError>> {
  return Result.tryPromise({
    catch: toStoreFailure,
    try: async () => {
      const [node] = await db.select().from(otterdNode).where(eq(otterdNode.nodeId, nodeId));
      if (!node) throw refusal("unknown-node", `no node ${nodeId}`);
      if (node.recoveryEpoch !== null)
        throw refusal("reenroll-pending", `${nodeId} already awaits re-enrollment`);
      const [fence] = await db
        .select()
        .from(otterdFence)
        .where(
          and(
            eq(otterdFence.nodeId, nodeId),
            eq(otterdFence.nodeEpoch, node.nodeEpoch),
            eq(otterdFence.state, "succeeded"),
          ),
        )
        .orderBy(desc(otterdFence.id))
        .limit(1);
      if (!fence)
        throw refusal("not-fenced", `${nodeId} has no verified fence of epoch ${node.nodeEpoch}`);
      const open = await db
        .select({ grantId: otterdGrant.grantId })
        .from(otterdGrant)
        .where(
          and(
            eq(otterdGrant.nodeId, nodeId),
            eq(otterdGrant.nodeEpoch, node.nodeEpoch),
            ne(otterdGrant.state, "released"),
          ),
        );
      if (open.length > 0) {
        throw refusal(
          "grants-unresolved",
          `grants of epoch ${node.nodeEpoch} not yet released: ${open.map((g) => g.grantId).join(", ")}`,
        );
      }
      const nodeEpoch = node.nodeEpoch + 1;
      const host = hostBinding.safeParse(node.host);
      if (!host.success) throw refusal("host-binding", host.error.message);
      let anchorSeq = node.anchorSeq;
      if (cfg.anchor) {
        const appended = await cfg.anchor({
          nodeId,
          nodeEpoch,
          identityKeyId: node.identityKeyId,
          host: node.host,
        });
        if (appended.isErr()) throw refusal("anchor", appended.error.message);
        if (appended.value.result !== "committed")
          throw refusal("anchor-frozen", "enrollment frozen");
        anchorSeq = appended.value.seq;
      }
      return run(async (tx) => {
        const [authority] = await tx.select().from(otterdAuthority).limit(1);
        if (!authority) throw refusal("no-authority", "the control plane has no issuing authority");
        const cert: EnrollCertificate = {
          installId: authority.installId,
          nodeId,
          nodeEpoch,
          authorityTerm: authority.authorityTerm,
          roles: node.roles.flatMap((r) => {
            const role = nodeRole.safeParse(r);
            return role.success ? [role.data] : [];
          }),
          identityKeyId: node.identityKeyId,
          keyEpoch: node.keyEpoch,
          host: host.data,
          cpKeys: [{ key: cfg.signer.publicKey, epoch: 1 }],
          recoveryKey: cfg.recoveryKey,
          controlUrl: cfg.controlUrl,
          issuedAtUnixMs: now,
          reason: `re-enrollment after fence ${fence.id}`,
        };
        const certificate = signEnrollCertificate(cfg.signer, cert);
        const [moved] = await tx
          .update(otterdNode)
          .set({
            recoveryEpoch: node.nodeEpoch,
            nodeEpoch,
            reenrollCertificate: certificate,
            anchorSeq,
            sessionId: null,
            updatedAt: now,
          })
          .where(and(eq(otterdNode.nodeId, nodeId), eq(otterdNode.nodeEpoch, node.nodeEpoch)))
          .returning();
        if (!moved) throw refusal("raced", "the node's epoch changed meanwhile");
        await journal(tx, {
          at: now,
          kind: "reenroll-begun",
          nodeId,
          detail: { from: node.nodeEpoch, to: nodeEpoch, fenceId: fence.id, anchorSeq },
        });
        return { nodeEpoch };
      }).then((r) => r.unwrap());
    },
  });
}

export interface RecoveryWork {
  certificate: SignedEnvelope;
  /** The fence's barrier evidence for the old epoch, to retire unresolved Engine requests. */
  barrier: BarrierEvidence | null;
}

/** What a recovery session of `nodeId` at `epoch` must deliver, if any. */
export function recoveryWork(
  nodeId: string,
  epoch: number,
): Promise<Result<RecoveryWork | null, StoreFailure>> {
  return Result.tryPromise({
    catch: toStoreFailure,
    try: async () => {
      const [node] = await db.select().from(otterdNode).where(eq(otterdNode.nodeId, nodeId));
      if (!node || node.recoveryEpoch !== epoch) return null;
      const certificate = signedEnvelope.safeParse(node.reenrollCertificate);
      if (!certificate.success) return null;
      const [ev] = await db
        .select()
        .from(otterdEvidence)
        .where(
          and(
            eq(otterdEvidence.nodeId, nodeId),
            eq(otterdEvidence.nodeEpoch, epoch),
            inArray(otterdEvidence.kind, ["provider-power-off", "manual-fence"]),
          ),
        )
        .orderBy(desc(otterdEvidence.recordedAt))
        .limit(1);
      const barrier = barrierEvidence.safeParse(ev?.document);
      return { certificate: certificate.data, barrier: barrier.success ? barrier.data : null };
    },
  });
}

/** The node accepted its new epoch: the recovery epoch is closed for good. */
export function finishReenroll(
  nodeId: string,
  epoch: number,
  now: number,
): Promise<Result<void, StoreFailure>> {
  return run(async (tx) => {
    const [row] = await tx
      .update(otterdNode)
      .set({ recoveryEpoch: null, reenrollCertificate: null, updatedAt: now })
      .where(and(eq(otterdNode.nodeId, nodeId), eq(otterdNode.recoveryEpoch, epoch)))
      .returning();
    if (row)
      await journal(tx, {
        at: now,
        kind: "reenroll-accepted",
        nodeId,
        detail: { from: epoch, to: row.nodeEpoch },
      });
  });
}

/** Has the node's epoch `epoch` been fenced (a verified fence recorded)? */
export function isFenced(nodeId: string, epoch: number): Promise<Result<boolean, StoreFailure>> {
  return Result.tryPromise({
    catch: toStoreFailure,
    try: async () => {
      const rows = await db
        .select({ id: otterdFence.id })
        .from(otterdFence)
        .where(
          and(
            eq(otterdFence.nodeId, nodeId),
            eq(otterdFence.nodeEpoch, epoch),
            eq(otterdFence.state, "succeeded"),
          ),
        )
        .limit(1);
      return rows.length > 0;
    },
  });
}
