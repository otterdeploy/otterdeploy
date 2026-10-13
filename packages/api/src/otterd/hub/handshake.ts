import { type Signer, randomNonce, signHubProof } from "@otterdeploy/otterd-cp";
/**
 * The control plane's side of the control-channel handshake:
 * `hello` → `welcome` → `authenticate` → `ready`.
 *
 * The welcome carries a session proof signed by the control-plane key that
 * binds this session, node, epoch, boot, incarnation and both nonces; the
 * node's `authenticate` must carry the mirror proof signed by the identity
 * key recorded at enrollment. Anything else is refused before `ready`, with
 * no session recorded.
 */
import {
  CURRENT_RANGE,
  type ControlFrame,
  DEFAULT_LIMITS,
  type Feature,
  type SessionProof,
  commonFeatures,
  negotiate,
  sessionProof,
  verifyAndParse,
} from "@otterdeploy/otterd-proto";
import { Result } from "better-result";

export type Hello = Extract<ControlFrame, { type: "hello" }>;
export type Welcome = Extract<ControlFrame, { type: "welcome" }>;
export type Reject = Extract<ControlFrame, { type: "reject" }>;

/** What the control plane knows of an enrolled node. */
export interface KnownNode {
  nodeId: string;
  nodeEpoch: number;
  identityKey: string;
  identityKeyId: string;
  retired: boolean;
  /** After a fence: the old epoch, allowed one recovery session to accept the new one. */
  recoveryEpoch: number | null;
  /** The current epoch was fenced: no session until the node is re-enrolled. */
  fenced: boolean;
}

/** Features this hub speaks (none of the optional channels yet). */
const HUB_FEATURES: readonly Feature[] = [];

const reject = (code: Reject["code"], message: string, extra: Partial<Reject> = {}): Reject => ({
  type: "reject",
  code,
  message,
  ...extra,
});

export interface Pending {
  hello: Hello;
  welcome: Welcome;
  expected: SessionProof;
  /** A recovery session at the node's previous epoch: it only carries the re-enrollment. */
  recovery: boolean;
}

/** Validate `hello` and build the signed `welcome`, or the refusal. */
export function welcome(
  hello: Hello,
  ctx: {
    installId: string;
    authorityTerm: number;
    signer: Signer;
    node: KnownNode | null;
    now: number;
  },
): Result<Pending, Reject> {
  const protocol = negotiate(hello.protocol, CURRENT_RANGE);
  if (protocol.isErr()) {
    return Result.err(reject("unsupported-protocol", protocol.error, { supported: CURRENT_RANGE }));
  }
  if (hello.channel !== "control")
    return Result.err(reject("unsupported-protocol", "only the control channel is served"));
  if (hello.installId !== ctx.installId)
    return Result.err(reject("wrong-install", "another install"));
  const node = ctx.node;
  if (!node) return Result.err(reject("unknown-node", `${hello.nodeId} is not enrolled`));
  if (node.retired) return Result.err(reject("revoked", `${hello.nodeId} is retired`));
  const recovery = node.recoveryEpoch !== null && hello.nodeEpoch === node.recoveryEpoch;
  if (hello.nodeEpoch !== node.nodeEpoch && !recovery) {
    return Result.err(
      reject("stale-epoch", `node epoch ${hello.nodeEpoch}, current ${node.nodeEpoch}`),
    );
  }
  if (hello.identityKeyId !== node.identityKeyId)
    return Result.err(reject("bad-proof", "unknown identity key"));
  if (node.fenced && !recovery) {
    return Result.err(
      reject("stale-epoch", `epoch ${hello.nodeEpoch} was fenced: re-enroll the node first`),
    );
  }
  const sessionId = `sess-${randomNonce().slice(0, 24)}`;
  const base = {
    channel: hello.channel,
    protocol: protocol.value,
    installId: hello.installId,
    sessionId,
    nodeId: hello.nodeId,
    nodeEpoch: hello.nodeEpoch,
    bootId: hello.bootId,
    incarnation: hello.incarnation,
    nodeNonce: hello.nodeNonce,
    cpNonce: randomNonce(),
  };
  return Result.ok({
    hello,
    expected: { role: "node", ...base },
    recovery,
    welcome: {
      type: "welcome",
      protocol: protocol.value,
      sessionId,
      cpNonce: base.cpNonce,
      authorityTerm: ctx.authorityTerm,
      cpUnixMs: ctx.now,
      limits: DEFAULT_LIMITS,
      features: commonFeatures(hello.features, HUB_FEATURES),
      hubProof: signHubProof(ctx.signer, base),
    },
  });
}

const PROOF_FIELDS = [
  "role",
  "channel",
  "protocol",
  "installId",
  "sessionId",
  "nodeId",
  "nodeEpoch",
  "bootId",
  "incarnation",
  "nodeNonce",
  "cpNonce",
] as const satisfies readonly (keyof SessionProof)[];

const same = (a: SessionProof, b: SessionProof): boolean =>
  PROOF_FIELDS.every((k) => a[k] === b[k]);

/** Check `authenticate`: the node's proof under its enrolled key, for exactly this session. */
export function authenticate(
  pending: Pending,
  frame: ControlFrame,
  identityKey: string,
): Result<void, Reject> {
  if (frame.type !== "authenticate")
    return Result.err(reject("bad-proof", `expected authenticate, got ${frame.type}`));
  if (frame.sessionId !== pending.welcome.sessionId)
    return Result.err(reject("bad-proof", "another session"));
  const proof = verifyAndParse(frame.nodeProof, [identityKey], "otterd/session/v1", sessionProof);
  if (proof.isErr()) return Result.err(reject("bad-proof", proof.error.kind));
  if (!same(proof.value, pending.expected))
    return Result.err(reject("bad-proof", "proof binds another session"));
  return Result.ok(undefined);
}
