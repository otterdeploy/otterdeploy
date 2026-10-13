import { signCapability } from "@otterdeploy/otterd-cp";
/**
 * One command over a live session: record it, sign a capability bound to
 * this session, send it, and wait for the answer or the timeout.
 */
import { type Command, type ControlFrame, encodeCommand } from "@otterdeploy/otterd-proto";
import { Result } from "better-result";

import type { Answer, Connection, HubConfig, RequestOptions, Session } from "./connection";

import { answerCommand, recordCommand } from "../store/commands";
import { HubError } from "./connection";

export async function sendRequest(
  conn: Connection,
  s: Session,
  command: Command,
  opts: RequestOptions,
  cfg: HubConfig,
): Promise<Result<Answer, HubError>> {
  const { payload, payloadHash } = encodeCommand(command);
  const now = cfg.now();
  const recorded = await recordCommand(
    {
      opId: opts.opId,
      nodeId: s.node.nodeId,
      verb: command.verb,
      payloadHash,
      grantId: opts.grantId ?? null,
      operationEpoch: opts.operationEpoch,
    },
    now,
  );
  if (recorded.isErr())
    return Result.err(new HubError({ message: recorded.error.message, code: "store" }));
  const capability = signCapability(cfg.signer, {
    installId: cfg.installId,
    nodeId: s.node.nodeId,
    nodeEpoch: s.node.nodeEpoch,
    sessionId: s.sessionId,
    authorityTerm: cfg.authorityTerm(),
    verb: command.verb,
    opId: opts.opId,
    operationEpoch: opts.operationEpoch,
    payloadHash,
    ...(opts.resourceId === undefined ? {} : { resourceId: opts.resourceId }),
    ...(opts.binding === undefined ? {} : { binding: opts.binding }),
    now,
  });
  const id = conn.nextId++;
  const answer = new Promise<Answer | null>((resolve) => {
    const timer = setTimeout(() => {
      conn.waiting.delete(id);
      resolve(null);
    }, opts.timeoutMs ?? 60_000);
    conn.waiting.set(id, (a) => {
      clearTimeout(timer);
      resolve(a);
    });
  });
  conn.send({ type: "request", id, capability, payload });
  const a = await answer;
  if (a === null) {
    await answerCommand(opts.opId, "unknown", { reason: "no answer in time" }, cfg.now());
    return Result.err(new HubError({ message: "no answer in time", code: "timeout" }));
  }
  const state =
    a.kind === "outcome" && a.outcome.status === "completed"
      ? "completed"
      : a.kind === "outcome" && a.outcome.status === "unknown"
        ? "unknown"
        : "failed";
  await answerCommand(opts.opId, state, { answer: a }, cfg.now());
  return Result.ok(a);
}

/** A node's answer to a request settles whoever is waiting for it. */
export function settleRequest(
  conn: Connection,
  frame: Extract<ControlFrame, { type: "response" | "requestRefused" }>,
): void {
  conn.waiting.get(frame.id)?.(
    frame.type === "response"
      ? { kind: "outcome", duplicate: frame.duplicate, outcome: frame.outcome }
      : { kind: "refused", error: frame.error },
  );
  conn.waiting.delete(frame.id);
}
