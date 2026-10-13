/**
 * The node side of the scheduler's actions: send a grant (`workload.apply`)
 * and judge the answer, send a stop and record its certificate, and run a
 * node's fence through its adapter. Called after the store's transaction,
 * never inside one.
 */
import type { ServiceSpec } from "@otterdeploy/otterd-proto";

import { machineBinding } from "@otterdeploy/otterd-cp";
import { log } from "evlog";

import type { ControllerConfig } from "./controller";
import type { GrantRow } from "./store/rows";

import { mintId } from "./store/errors";
import { beginFence, finishFence, recordRefusal, recordStopCertificate } from "./store/evidence";
import { markGrant } from "./store/grants";
import { nodeRow } from "./store/nodes";
import { revisionOf } from "./store/services";
import { fenceHetzner } from "./tools";

export async function sendApply(
  cfg: ControllerConfig,
  g: GrantRow,
  spec: ServiceSpec,
  adoptsAttempt: string | null,
  stop: (grantId: string, reason: string) => Promise<void>,
): Promise<void> {
  const slot = { resourceId: g.resourceId, index: g.slotIndex };
  const answer = await cfg.hub.request(
    g.nodeId,
    {
      verb: "workload.apply",
      grant: {
        grantId: g.grantId,
        slot,
        generation: g.generation,
        authorityTerm: g.authorityTerm,
        nodeEpoch: g.nodeEpoch,
        incarnation: g.incarnation,
        exclusive: g.exclusive,
        disconnectAction: spec.lifecycle.disconnectAction,
        restart: spec.task.restart,
        dataClaims: [],
        probeOnly: false,
        ...(adoptsAttempt === null ? {} : { adoptsAttempt }),
      },
      spec,
    },
    {
      opId: g.opId,
      operationEpoch: g.operationEpoch,
      resourceId: g.resourceId,
      grantId: g.grantId,
      binding: { slot, grantId: g.grantId, generation: g.generation },
    },
  );
  const now = cfg.now();
  if (
    answer.isOk() &&
    answer.value.kind === "outcome" &&
    answer.value.outcome.status === "completed"
  ) {
    await markGrant(
      g.grantId,
      "applied",
      now,
      adoptsAttempt ? `adopted ${adoptsAttempt}` : "applied",
    );
    return;
  }
  const definitive =
    answer.isOk() &&
    (answer.value.kind === "refused" ||
      (answer.value.outcome.status === "failed" && answer.value.outcome.sideEffects === "none") ||
      answer.value.outcome.status === "rejected");
  if (definitive) {
    await recordRefusal(g.grantId, g.opId, { answer: answer.value }, now);
    return;
  }
  // Possible side effects or no answer: only a certificate may release it.
  log.warn({
    otterd: {
      event: "apply not confirmed",
      grant: g.grantId,
      answer: answer.isOk() ? answer.value : answer.error.message,
    },
  });
  await stop(g.grantId, "apply not confirmed");
}

export async function sendStop(cfg: ControllerConfig, g: GrantRow, reason: string): Promise<void> {
  const rev = await revisionOf(g.resourceId, g.specRevision);
  const operationEpoch = rev.isOk() ? rev.value.operationEpoch : g.operationEpoch;
  const answer = await cfg.hub.request(
    g.nodeId,
    { verb: "workload.stop", grantId: g.grantId, reason },
    { opId: mintId("op"), operationEpoch, resourceId: g.resourceId, grantId: g.grantId },
  );
  if (answer.isErr() || answer.value.kind !== "outcome") return;
  const o = answer.value.outcome;
  if (o.status === "completed" && o.result.kind === "stopped") {
    const r = await recordStopCertificate(g.grantId, o.result.certificate, cfg.now());
    if (r.isErr())
      log.error({
        otterd: { event: "stop certificate refused", grant: g.grantId, error: r.error.message },
      });
  } else {
    log.info({ otterd: { event: "stop not yet certified", grant: g.grantId, outcome: o } });
  }
}

export async function runFence(
  cfg: ControllerConfig,
  nodeId: string,
  reason: string,
): Promise<void> {
  const node = await nodeRow(nodeId);
  const binding = machineBinding.safeParse(node.isOk() ? node.value?.fenceBinding : null);
  if (node.isErr() || !node.value || !binding.success) return;
  if (node.value.fenceAdapter !== "hetzner") {
    log.warn({
      otterd: {
        event: "fence needs an operator's proof",
        nodeId,
        adapter: node.value.fenceAdapter,
      },
    });
    return;
  }
  const begun = await beginFence(nodeId, cfg.now(), reason);
  if (begun.isErr()) {
    log.error({ otterd: { event: "fence not begun", nodeId, error: begun.error.message } });
    return;
  }
  log.warn({ otterd: { event: "fencing node", nodeId, reason, fence: begun.value.id } });
  const ev = await fenceHetzner(cfg.tools, binding.data);
  const outcome = ev.isOk() ? { evidence: ev.value } : { error: ev.error.message };
  const done = await finishFence(begun.value.id, outcome, cfg.now());
  log.warn({
    otterd: {
      event: "fence finished",
      nodeId,
      state: done.isOk() ? done.value.state : done.error.message,
    },
  });
}
