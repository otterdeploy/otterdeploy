import { type EngineRestartPolicy, serviceSpec } from "@otterdeploy/otterd-proto";
import { log } from "evlog";

import type { Hub } from "../hub/hub";
/**
 * The control plane's half of a migration, run on every scheduler pass by
 * the leader. The host side (./controller.ts) prepares a container and
 * asks; this side talks to the node:
 *
 * - adopt-requested: admit generation 1 of slot 0 on the container's node
 *   with `adoptsContainer`, send `workload.apply`, and mark it adopted once
 *   the node completes. An unanswered apply is sent again with the same op
 *   id; it is never stopped, because the container must keep running.
 * - release-requested: send `workload.release-adoption` with the
 *   before-image restart policy; the node's `adoption-released` answer is
 *   the grant's retirement.
 * - after finalize: delete every adopted container a stop left behind
 *   (`workload.remove`), which only the control plane may ask for.
 */
import type { MigrationRow } from "./store";

import { grantRow } from "../store/adopt";
import { recordRefusal } from "../store/evidence";
import { admitGrant, markGrant, markSent, releaseGrant } from "../store/grants";
import { revisionOf } from "../store/services";
import { adoptedLeftBehind, currentSpec, markAdoptedRemoved, releaseAdoption } from "./cp-store";
import { currentSession, rowsIn, stepResource } from "./store";

export interface MigrationCpConfig {
  hub: Hub;
  now: () => number;
}

function restartPolicyOf(row: MigrationRow): EngineRestartPolicy {
  const p = row.beforeImage?.restartPolicy;
  if (p?.name === "on-failure")
    return { name: "on-failure", maximumRetryCount: p.maximumRetryCount ?? 0 };
  if (p?.name === "always" || p?.name === "unless-stopped") return { name: p.name };
  return { name: "no" };
}

async function admitAdoption(cfg: MigrationCpConfig, row: MigrationRow): Promise<string | null> {
  if (row.grantId) return row.grantId;
  if (!row.nodeId || !row.containerId) return null;
  const svc = await currentSpec(row.resourceId);
  if (svc.isErr()) return null;
  const g = await admitGrant({
    resourceId: row.resourceId,
    slotIndex: 0,
    nodeId: row.nodeId,
    exclusive: svc.value.spec.lifecycle.exclusive,
    surge: false,
    specRevision: svc.value.revision,
    reason: "migration: adopt the running container in place",
    now: cfg.now(),
    adoptsContainer: row.containerId,
  });
  if (g.isErr()) {
    await stepResource(row.resourceId, "failed", cfg.now(), { error: g.error.message });
    return null;
  }
  await stepResource(row.resourceId, "adopt-requested", cfg.now(), { grantId: g.value.grantId });
  return g.value.grantId;
}

async function adopt(cfg: MigrationCpConfig, row: MigrationRow): Promise<void> {
  const grantId = await admitAdoption(cfg, row);
  if (!grantId) return;
  const sent = await markSent(grantId, cfg.now());
  if (sent.isErr()) return;
  const g = sent.value;
  const svc = await revisionOf(g.resourceId, g.specRevision);
  const spec = svc.isOk() ? serviceSpec.safeParse(svc.value.spec) : null;
  if (!spec?.success) return;
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
        disconnectAction: spec.data.lifecycle.disconnectAction,
        restart: spec.data.task.restart,
        dataClaims: [],
        probeOnly: false,
        adoptsContainer: row.containerId ?? "",
        ...(g.network ? { network: g.network } : {}),
      },
      spec: spec.data,
    },
    {
      opId: g.opId,
      operationEpoch: g.operationEpoch,
      resourceId: g.resourceId,
      grantId: g.grantId,
      binding: { slot, grantId: g.grantId, generation: g.generation },
    },
  );
  if (answer.isErr() || answer.value.kind !== "outcome") return; // sent again next pass
  const o = answer.value.outcome;
  if (o.status === "completed") {
    await markGrant(g.grantId, "applied", cfg.now(), `adopted ${row.containerId}`);
    await stepResource(row.resourceId, "adopted", cfg.now());
  } else if (o.status === "failed" || o.status === "rejected") {
    await refused(cfg, row, g, answer.value, o.status === "rejected" || o.sideEffects === "none");
  }
}

/**
 * The node refused the adoption. With no side effects the refusal retires
 * the grant, so the host side can give the container back as it was.
 */
async function refused(
  cfg: MigrationCpConfig,
  row: MigrationRow,
  g: { grantId: string; opId: string },
  answer: { kind: "outcome"; outcome: { status: string; code?: string; message?: string } },
  clean: boolean,
): Promise<void> {
  if (clean) {
    const recorded = await recordRefusal(g.grantId, g.opId, { answer }, cfg.now());
    if (recorded.isOk()) await releaseGrant(g.grantId, cfg.now());
  }
  await stepResource(row.resourceId, "failed", cfg.now(), { error: failureOf(answer.outcome) });
}

/** The node's own words for a failed or rejected apply. */
function failureOf(o: { status: string; code?: string; message?: string }): string {
  return o.message ? `${o.code ?? o.status}: ${o.message}` : JSON.stringify(o);
}

async function giveBack(cfg: MigrationCpConfig, row: MigrationRow): Promise<void> {
  if (!row.grantId) {
    await stepResource(row.resourceId, "released", cfg.now());
    return;
  }
  const g = await grantRow(row.grantId);
  if (g.isErr() || !g.value) return;
  const answer = await cfg.hub.request(
    g.value.nodeId,
    {
      verb: "workload.release-adoption",
      grantId: row.grantId,
      restartPolicy: restartPolicyOf(row),
    },
    {
      opId: `${g.value.opId}-give-back`,
      operationEpoch: await currentEpoch(g.value),
      resourceId: row.resourceId,
      grantId: row.grantId,
    },
  );
  if (answer.isErr() || answer.value.kind !== "outcome") return;
  const o = answer.value.outcome;
  if (o.status === "completed" && o.result.kind === "adoption-released") {
    const released = await releaseAdoption(row.grantId, o.result.container, cfg.now());
    if (released.isOk()) await stepResource(row.resourceId, "released", cfg.now());
  } else if (o.status !== "completed") {
    await stepResource(row.resourceId, "failed", cfg.now(), { error: JSON.stringify(o) });
  }
}

/**
 * The resource's operation epoch now. A later command must carry the
 * current one: the node refuses anything below its high-water mark, and
 * every grant issued since this one raised it.
 */
async function currentEpoch(g: {
  resourceId: string;
  specRevision: number;
  operationEpoch: number;
}) {
  const rev = await revisionOf(g.resourceId, g.specRevision);
  return rev.isOk() ? rev.value.operationEpoch : g.operationEpoch;
}

/** After finalize: delete adopted containers their stop kept. */
async function removeLeftBehind(cfg: MigrationCpConfig): Promise<void> {
  const left = await adoptedLeftBehind();
  if (left.isErr()) return;
  for (const g of left.value) {
    const answer = await cfg.hub.request(
      g.nodeId,
      { verb: "workload.remove", grantId: g.grantId },
      {
        opId: `${g.opId}-remove`,
        operationEpoch: await currentEpoch(g),
        resourceId: g.resourceId,
        grantId: g.grantId,
      },
    );
    if (
      answer.isOk() &&
      answer.value.kind === "outcome" &&
      answer.value.outcome.status === "completed"
    ) {
      await markAdoptedRemoved(g.grantId, cfg.now());
    }
  }
}

export async function processMigrations(cfg: MigrationCpConfig): Promise<void> {
  const rows = await rowsIn(["adopt-requested", "release-requested"]);
  if (rows.isErr()) {
    log.error({ otterd: { event: "migration rows unreadable", error: rows.error.message } });
    return;
  }
  for (const row of rows.value) {
    if (row.state === "adopt-requested") await adopt(cfg, row);
    if (row.state === "release-requested") await giveBack(cfg, row);
  }
  const session = await currentSession();
  if (session.isOk() && session.value?.state === "finalized") await removeLeftBehind(cfg);
}
