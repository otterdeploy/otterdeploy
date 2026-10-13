/**
 * A node's acknowledgement of a serving set. It counts only when it names a
 * document this control plane sent that node (revision and payload digest).
 *
 * An install acknowledgement records the revision. A drain acknowledgement
 * says the node no longer forwards to those attempts: before the attempt's
 * grant is released the node simply stops being one of its forwarding peers;
 * after, it acknowledges the quarantined address, which is freed once every
 * peer has.
 */
import { otterdGrant, otterdService } from "@otterdeploy/db/schema/otterd";
import { otterdServing } from "@otterdeploy/db/schema/otterd-network";
import { ipam } from "@otterdeploy/otterd-cp";
import { type ControlFrame } from "@otterdeploy/otterd-proto";
import { Result } from "better-result";
import { and, eq, isNotNull } from "drizzle-orm";

import type { Tx } from "../../health-data/sql";

import { type StoreFailure, run } from "./errors";
import { journal } from "./journal";
import { readPlan, writePlan } from "./plan-row";

export type AuthorityAck = Extract<ControlFrame, { type: "authorityAck" }>;

/** Acknowledge the released addresses of these attempts; returns how many were freed. */
async function acknowledgeReleased(
  tx: Tx,
  resourceId: string,
  nodeId: string,
  drained: readonly string[],
  now: number,
): Promise<number> {
  const released = await tx
    .select()
    .from(otterdGrant)
    .where(and(eq(otterdGrant.resourceId, resourceId), isNotNull(otterdGrant.networkReleasedAt)));
  const addresses = released.flatMap((g) =>
    g.network && g.attempts.some((a) => drained.includes(a)) ? [g.network.address] : [],
  );
  if (addresses.length === 0) return 0;
  const loaded = await readPlan(tx);
  let freed = 0;
  let touched = false;
  for (const text of addresses) {
    const address = ipam.parseAddr(text);
    const done = address === null ? null : ipam.acknowledgeAddress(loaded.plan, address, nodeId);
    if (done?.isOk()) {
      touched = true;
      if (done.value) freed += 1;
    }
  }
  if (touched) await writePlan(tx, loaded, now);
  return freed;
}

export function acknowledgeAuthority(
  nodeId: string,
  ack: AuthorityAck,
  now: number,
): Promise<Result<number, StoreFailure>> {
  return run(async (tx) => {
    if (ack.context !== "otterd/serving-set/v1") return 0;
    const [svc] = await tx
      .select({ resourceId: otterdService.resourceId })
      .from(otterdService)
      .where(eq(otterdService.vipId, ack.vipId));
    const [row] = svc
      ? await tx
          .select()
          .from(otterdServing)
          .where(eq(otterdServing.resourceId, svc.resourceId))
          .for("update")
      : [];
    const sent = row?.sentTo[nodeId];
    const named = sent?.digests.some(
      (d) => d.revision === ack.servingRevision && d.digest === ack.documentDigest,
    );
    if (!svc || !row || !sent || !named) {
      await journal(tx, {
        at: now,
        kind: "serving-ack-unmatched",
        nodeId,
        detail: { vipId: ack.vipId, revision: ack.servingRevision, digest: ack.documentDigest },
      });
      return 0;
    }
    const drained = ack.drainedAttempts ?? [];
    const listed = Object.fromEntries(
      Object.entries(row.listed).map(([a, nodes]) => [
        a,
        drained.includes(a) ? nodes.filter((n) => n !== nodeId) : nodes,
      ]),
    );
    const installed =
      drained.length === 0 ? Math.max(sent.installed ?? 0, ack.servingRevision) : sent.installed;
    await tx
      .update(otterdServing)
      .set({
        listed,
        sentTo: {
          ...row.sentTo,
          [nodeId]: { ...sent, ...(installed === undefined ? {} : { installed }) },
        },
      })
      .where(eq(otterdServing.resourceId, row.resourceId));
    const freed = await acknowledgeReleased(tx, row.resourceId, nodeId, drained, now);
    if (drained.length > 0) {
      await journal(tx, {
        at: now,
        kind: "serving-drained",
        resourceId: row.resourceId,
        nodeId,
        detail: { revision: ack.servingRevision, drained, freed },
      });
    }
    return freed;
  });
}
