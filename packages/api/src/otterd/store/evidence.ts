/**
 * Recording positive retirement. A stop certificate is verified against the
 * node's identity key and every attempt the store has seen for the grant. A
 * fence first revokes every live grant on the node in one transaction, then
 * records the request; its evidence is accepted only if it names the bound
 * machine, follows that revocation and ends in a verified off state.
 */
import type { SignedEnvelope } from "@otterdeploy/otterd-proto";

import {
  otterdAuthority,
  otterdEvidence,
  otterdFence,
  otterdGrant,
  otterdNode,
} from "@otterdeploy/db/schema/otterd";
import {
  type FenceEvidence,
  acceptFence,
  machineBinding,
  verifyStopCertificate,
} from "@otterdeploy/otterd-cp";
import { Result } from "better-result";
import { and, eq, isNull, ne } from "drizzle-orm";
import * as z from "zod";

import type { FenceRow } from "./rows";

import { type StoreFailure, refusal, run } from "./errors";
import { journal } from "./journal";
import { fenceNetworkPeer } from "./network";

/** Verify and store a node's stop certificate for a grant. Idempotent per grant. */
export function recordStopCertificate(
  grantId: string,
  envelope: SignedEnvelope,
  now: number,
): Promise<Result<string, StoreFailure>> {
  return run(async (tx) => {
    const [g] = await tx
      .select()
      .from(otterdGrant)
      .where(eq(otterdGrant.grantId, grantId))
      .for("update");
    if (!g) throw refusal("unknown-grant", `no grant ${grantId}`);
    const [node] = await tx.select().from(otterdNode).where(eq(otterdNode.nodeId, g.nodeId));
    const [authority] = await tx.select().from(otterdAuthority).limit(1);
    if (!node || !authority) throw refusal("unknown-node", `no node ${g.nodeId}`);
    const cert = verifyStopCertificate(envelope, {
      installId: authority.installId,
      nodeId: g.nodeId,
      nodeEpoch: g.nodeEpoch,
      identityKey: node.identityKey,
      grantId,
      slot: { resourceId: g.resourceId, index: g.slotIndex },
      knownAttemptIds: g.attempts,
    });
    if (cert.isErr()) throw refusal(`certificate-${cert.error.code}`, cert.error.detail);
    const evidenceId = `cert_${grantId}`;
    await tx
      .insert(otterdEvidence)
      .values({
        evidenceId,
        kind: "stop-certificate",
        nodeId: g.nodeId,
        nodeEpoch: g.nodeEpoch,
        grantId,
        document: { envelope, certificate: cert.value },
        observedAt: cert.value.issuedAtUnixMs,
        recordedAt: now,
      })
      .onConflictDoNothing();
    await journal(tx, {
      at: now,
      kind: "stop-certified",
      resourceId: g.resourceId,
      slotIndex: g.slotIndex,
      nodeId: g.nodeId,
      grantId,
      detail: { attempts: cert.value.attemptIds, mutations: cert.value.mutationCount },
    });
    return evidenceId;
  });
}

/**
 * The node definitively refused a grant's own apply with no side effects
 * (before claiming it, or claimed and refused before any Engine request):
 * the grant never started anything and may be released.
 */
const refusedOutcome = z.object({
  answer: z.object({ outcome: z.object({ code: z.string(), message: z.string() }) }),
});

export function recordRefusal(
  grantId: string,
  opId: string,
  answer: Record<string, unknown>,
  now: number,
): Promise<Result<string, StoreFailure>> {
  return run(async (tx) => {
    const [g] = await tx
      .select()
      .from(otterdGrant)
      .where(eq(otterdGrant.grantId, grantId))
      .for("update");
    if (!g) throw refusal("unknown-grant", `no grant ${grantId}`);
    if (g.opId !== opId) throw refusal("op-mismatch", `${opId} is not the apply of ${grantId}`);
    // A definitive failure names its reason: kept on the grant for the deploy status.
    const failed = refusedOutcome.safeParse(answer);
    if (failed.success) {
      const { code, message } = failed.data.answer.outcome;
      await tx
        .update(otterdGrant)
        .set({ failure: { code, message } })
        .where(eq(otterdGrant.grantId, grantId));
    }
    const evidenceId = `refused_${grantId}`;
    await tx
      .insert(otterdEvidence)
      .values({
        evidenceId,
        kind: "refused",
        nodeId: g.nodeId,
        nodeEpoch: g.nodeEpoch,
        grantId,
        document: { opId, answer },
        observedAt: now,
        recordedAt: now,
      })
      .onConflictDoNothing();
    await journal(tx, {
      at: now,
      kind: "apply-refused",
      resourceId: g.resourceId,
      slotIndex: g.slotIndex,
      nodeId: g.nodeId,
      grantId,
      detail: { opId, answer },
    });
    return evidenceId;
  });
}

/**
 * Begin a fence of a node's current epoch: revoke every live grant on it and
 * record the request in one transaction. At most one fence is in flight per
 * node epoch (unique index). Refused unless the node has an enabled adapter.
 */
export function beginFence(
  nodeId: string,
  now: number,
  reason: string,
): Promise<Result<FenceRow, StoreFailure>> {
  return run(async (tx) => {
    const [node] = await tx
      .select()
      .from(otterdNode)
      .where(eq(otterdNode.nodeId, nodeId))
      .for("update");
    if (!node) throw refusal("unknown-node", `no node ${nodeId}`);
    if (!node.fenceEnabled || !node.fenceAdapter || !node.fenceBinding) {
      throw refusal("fence-disabled", `${nodeId} has no enabled fence`);
    }
    await tx
      .update(otterdGrant)
      .set({ revokedAt: now })
      .where(
        and(
          eq(otterdGrant.nodeId, nodeId),
          ne(otterdGrant.state, "released"),
          isNull(otterdGrant.revokedAt),
        ),
      );
    await tx
      .update(otterdGrant)
      .set({ state: "unknown" })
      .where(
        and(
          eq(otterdGrant.nodeId, nodeId),
          ne(otterdGrant.state, "released"),
          ne(otterdGrant.state, "stopping"),
        ),
      );
    const [fence] = await tx
      .insert(otterdFence)
      .values({
        nodeId,
        nodeEpoch: node.nodeEpoch,
        adapter: node.fenceAdapter,
        revokedAt: now,
        requestedAt: now,
        state: "requested",
      })
      .returning();
    if (!fence) throw refusal("insert-failed", "fence not recorded");
    await journal(tx, {
      at: now,
      kind: "fence-requested",
      nodeId,
      detail: { reason, fenceId: fence.id },
    });
    return fence;
  });
}

/** Record a fence's outcome: verified evidence, or a failure (no evidence). */
export function finishFence(
  fenceId: number,
  outcome: { evidence: FenceEvidence } | { error: string },
  now: number,
): Promise<Result<FenceRow, StoreFailure>> {
  return run(async (tx) => {
    const [fence] = await tx
      .select()
      .from(otterdFence)
      .where(eq(otterdFence.id, fenceId))
      .for("update");
    if (!fence || fence.state !== "requested")
      throw refusal("fence-not-in-flight", `fence ${fenceId}`);
    const [node] = await tx.select().from(otterdNode).where(eq(otterdNode.nodeId, fence.nodeId));
    const binding = machineBinding.safeParse(node?.fenceBinding);
    const record = "evidence" in outcome ? outcome.evidence : null;
    const accepted =
      record === null || !binding.success
        ? null
        : acceptFence(record, {
            nodeEpoch: fence.nodeEpoch,
            binding: binding.data,
            revokedAt: fence.revokedAt,
          });
    if (record === null || accepted === null || accepted.isErr()) {
      const error =
        "error" in outcome
          ? outcome.error
          : accepted?.isErr()
            ? accepted.error.detail
            : "no machine binding";
      const [failed] = await tx
        .update(otterdFence)
        .set({ state: "failed", error, finishedAt: now })
        .where(eq(otterdFence.id, fenceId))
        .returning();
      await journal(tx, {
        at: now,
        kind: "fence-failed",
        nodeId: fence.nodeId,
        detail: { fenceId, error },
      });
      return failed ?? fence;
    }
    const barrier = accepted.value;
    await tx.insert(otterdEvidence).values({
      evidenceId: barrier.evidenceId,
      kind: barrier.method,
      nodeId: fence.nodeId,
      nodeEpoch: fence.nodeEpoch,
      document: barrier,
      observedAt: barrier.observedAtUnixMs,
      recordedAt: now,
    });
    const [done] = await tx
      .update(otterdFence)
      .set({ state: "succeeded", evidenceId: barrier.evidenceId, finishedAt: now })
      .where(eq(otterdFence.id, fenceId))
      .returning();
    await journal(tx, {
      at: now,
      kind: "fence-succeeded",
      nodeId: fence.nodeId,
      detail: { fenceId, evidence: barrier, record },
    });
    await fenceNetworkPeer(tx, fence.nodeId, now);
    return done ?? fence;
  });
}
