/**
 * Publishing serving sets. After each scheduler pass, every VIP service's
 * backends are compared with the last published set; a change raises its
 * revision. Each connected node is then sent the current set of every VIP
 * once per revision and session, so a node that reconnects is brought up to
 * date. Sets are signed with the control plane's key.
 */
import type { Signer } from "@otterdeploy/otterd-cp";

import { type ServingSet, sha256HexOf } from "@otterdeploy/otterd-proto";
import { log } from "evlog";

import type { Hub } from "./hub/hub";

import {
  type ServingRow,
  type ServingTarget,
  markServingSent,
  recordServing,
  servingTargets,
} from "./store/serving";

export interface ServingConfig {
  hub: Hub;
  signer: Signer;
  installId: string;
  authorityTerm: () => number;
  now: () => number;
}

function document(cfg: ServingConfig, t: ServingTarget, row: ServingRow): ServingSet {
  return {
    installId: cfg.installId,
    authorityTerm: cfg.authorityTerm(),
    scopeId: t.scopeId,
    vipId: t.vipId,
    vipAddress: t.vipAddress,
    names: t.names,
    ports: t.ports,
    servingRevision: row.revision,
    operationEpoch: t.operationEpoch,
    newFlowAttempts: row.attempts.map((a) => ({
      grantId: a.grantId,
      attemptId: a.attemptId,
      nodeEpoch: a.nodeEpoch,
      address: a.address,
      ports: t.ports,
    })),
    withdrawals: row.withdrawals.map((w) => ({
      attemptId: w.attemptId,
      withdrawalRevision: w.withdrawalRevision,
      drainBudgetMs: w.drainBudgetMs,
    })),
  };
}

export async function publishServing(
  cfg: ServingConfig,
  nodeIds: readonly string[],
): Promise<void> {
  const targets = await servingTargets();
  if (targets.isErr()) {
    log.error({ otterd: { event: "serving sets not read", error: targets.error.message } });
    return;
  }
  for (const t of targets.value) {
    const row = await recordServing(t, cfg.now());
    if (row.isErr()) continue;
    const envelope = cfg.signer.sign("otterd/serving-set/v1", document(cfg, t, row.value));
    const digest = sha256HexOf(Buffer.from(envelope.payload, "base64"));
    for (const nodeId of nodeIds) {
      const sessionId = cfg.hub.sessionOf(nodeId);
      const sent = row.value.sentTo[nodeId];
      if (!sessionId || (sent?.revision === row.value.revision && sent.sessionId === sessionId)) {
        continue;
      }
      const marked = await markServingSent(t.resourceId, nodeId, sessionId, {
        revision: row.value.revision,
        digest,
      });
      if (marked.isOk() && marked.value) cfg.hub.pushAuthority(nodeId, envelope);
    }
  }
}
