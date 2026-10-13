import type { HubConfig } from "./connection";
import type { Connection, Session } from "./connection";
import type { KnownNode, Pending } from "./handshake";

import { finishReenroll, recoveryWork } from "../store/reenroll";
import { sendRequest } from "./requests";

const completed = (r: Awaited<ReturnType<typeof sendRequest>>): boolean =>
  r.isOk() && r.value.kind === "outcome" && r.value.outcome.status === "completed";

/**
 * A fenced node back at its previous epoch: retire its unresolved Engine
 * requests with the fence's barrier evidence, deliver the re-enrollment,
 * then send it away to reconnect at the new epoch. It never joins the
 * scheduler's sessions.
 */
export async function recover(
  conn: Connection,
  pending: Pending,
  node: KnownNode,
  cfg: HubConfig,
): Promise<boolean> {
  const epoch = pending.hello.nodeEpoch;
  const session: Session = {
    sessionId: pending.welcome.sessionId,
    node: { ...node, nodeEpoch: epoch },
    incarnation: pending.hello.incarnation,
    bootId: pending.hello.bootId,
  };
  conn.session = session;
  conn.state = "ready";
  conn.send({ type: "ready", sessionId: session.sessionId });
  const work = await recoveryWork(node.nodeId, epoch);
  if (work.isErr() || work.value === null) return false;
  const op = { operationEpoch: 0 };
  if (work.value.barrier) {
    const retired = await sendRequest(
      conn,
      session,
      { verb: "node.retireByBarrier", evidence: work.value.barrier },
      { ...op, opId: `op_retire_${session.sessionId}` },
      cfg,
    );
    if (!completed(retired)) return false;
  }
  const accepted = await sendRequest(
    conn,
    session,
    { verb: "node.reenroll", certificate: work.value.certificate },
    { ...op, opId: `op_reenroll_${session.sessionId}` },
    cfg,
  );
  if (!completed(accepted)) return false;
  await finishReenroll(node.nodeId, epoch, cfg.now());
  conn.send({
    type: "goAway",
    code: "stale-epoch",
    message: "re-enrolled: reconnect at the new epoch",
    reconnectAfterMs: 1_000,
  });
  return true;
}
