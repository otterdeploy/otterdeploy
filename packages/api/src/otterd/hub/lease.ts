/**
 * Lease renewal: a node asks to keep its grants alive; the hub signs a
 * renewal for those with no committed revocation, bound to this session's
 * node epoch, incarnation and boot.
 */
import { signLease } from "@otterdeploy/otterd-cp";
import { type ControlFrame } from "@otterdeploy/otterd-proto";

import type { Connection, HubConfig, Session } from "./connection";

import { leaseable } from "../store/reports";

export async function answerLease(
  conn: Connection,
  s: Session,
  frame: Extract<ControlFrame, { type: "leaseRequest" }>,
  cfg: HubConfig,
): Promise<void> {
  if (
    frame.nodeEpoch !== s.node.nodeEpoch ||
    frame.incarnation !== s.incarnation ||
    frame.bootId !== s.bootId
  ) {
    return;
  }
  const grants = await leaseable(s.node.nodeId, s.incarnation, frame.grants);
  if (grants.isErr()) return;
  const renewal = signLease(cfg.signer, {
    installId: cfg.installId,
    nodeId: s.node.nodeId,
    nodeEpoch: s.node.nodeEpoch,
    authorityTerm: cfg.authorityTerm(),
    bootId: s.bootId,
    incarnation: s.incarnation,
    nonce: frame.nonce,
    grants: grants.value,
  });
  conn.send({ type: "lease", renewal });
}
