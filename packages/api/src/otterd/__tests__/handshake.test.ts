/**
 * The hub's handshake: a welcome only for an enrolled node at its current
 * epoch and key, a hub proof the node can verify under the pinned key and that
 * binds both nonces, and an authenticate accepted only with the node's own
 * proof for exactly this session.
 */
import { seedSigner } from "@otterdeploy/otterd-cp";
import {
  CURRENT_RANGE,
  keyIdOf,
  publicKeyFromSeed,
  sessionProof,
  signEnvelope,
  verifyAndParse,
} from "@otterdeploy/otterd-proto";
import { describe, expect, it } from "vite-plus/test";

import { type Hello, type KnownNode, authenticate, welcome } from "../hub/handshake";

const cp = seedSigner(new Uint8Array(32).fill(1));
const nodeSeed = new Uint8Array(32).fill(2);
const nodeKey = publicKeyFromSeed(nodeSeed);
const known: KnownNode = {
  nodeId: "n1",
  nodeEpoch: 2,
  identityKey: nodeKey,
  identityKeyId: keyIdOf(nodeKey),
  retired: false,
  recoveryEpoch: null,
  fenced: false,
};
const hello: Hello = {
  type: "hello",
  protocol: CURRENT_RANGE,
  channel: "control",
  installId: "inst",
  nodeId: "n1",
  nodeEpoch: 2,
  keyEpoch: 1,
  identityKeyId: keyIdOf(nodeKey),
  bootId: "boot-1",
  incarnation: "inc-1",
  otterdVersion: "0.1.0",
  journalFormat: 1,
  features: ["key-rotation"],
  nodeNonce: "a".repeat(64),
};
const ctx = {
  installId: "inst",
  authorityTerm: 4,
  signer: cp,
  node: known,
  now: 1_900_000_000_000,
};

function nodeAnswer(
  w: ReturnType<typeof welcome>,
  over: Record<string, unknown> = {},
  seed = nodeSeed,
) {
  const p = w.unwrap();
  const proof = { ...p.expected, ...over };
  return {
    type: "authenticate" as const,
    sessionId: p.welcome.sessionId,
    nodeProof: signEnvelope(
      seed,
      "otterd/session/v1",
      new TextEncoder().encode(JSON.stringify(proof)),
    ),
  };
}

describe("hub handshake", () => {
  it("welcomes an enrolled node with a proof binding the session, node and both nonces", () => {
    const w = welcome(hello, ctx).unwrap().welcome;
    expect(w).toMatchObject({ authorityTerm: 4, cpUnixMs: ctx.now, features: [] });
    const proof = verifyAndParse(
      w.hubProof,
      [cp.publicKey],
      "otterd/session/v1",
      sessionProof,
    ).unwrap();
    expect(proof).toEqual({
      role: "hub",
      channel: "control",
      protocol: 1,
      installId: "inst",
      sessionId: w.sessionId,
      nodeId: "n1",
      nodeEpoch: 2,
      bootId: "boot-1",
      incarnation: "inc-1",
      nodeNonce: "a".repeat(64),
      cpNonce: w.cpNonce,
    });
  });

  it.each([
    ["another install", { installId: "other" }, {}, "wrong-install"],
    ["an older epoch", { nodeEpoch: 1 }, {}, "stale-epoch"],
    ["another identity key", { identityKeyId: "f".repeat(32) }, {}, "bad-proof"],
    ["the bulk channel", { channel: "bulk" }, {}, "unsupported-protocol"],
    ["a protocol it cannot speak", { protocol: { min: 9, max: 9 } }, {}, "unsupported-protocol"],
    ["a retired node", {}, { retired: true }, "revoked"],
  ] as const)("rejects %s", (_, h, n, code) => {
    const r = welcome({ ...hello, ...h }, { ...ctx, node: { ...known, ...n } });
    expect(r.isErr() && r.error.code).toBe(code);
  });

  it("lets a fenced node at its previous epoch in once, as a recovery session", () => {
    const after = { ...known, nodeEpoch: 3, recoveryEpoch: 2 };
    expect(welcome(hello, { ...ctx, node: after }).unwrap().recovery).toBe(true);
    const r = welcome({ ...hello, nodeEpoch: 1 }, { ...ctx, node: after });
    expect(r.isErr() && r.error.code).toBe("stale-epoch");
    expect(welcome(hello, ctx).unwrap().recovery).toBe(false);
    const fenced = welcome(hello, { ...ctx, node: { ...known, fenced: true } });
    expect(fenced.isErr() && fenced.error.code).toBe("stale-epoch");
  });

  it("rejects an unknown node", () => {
    const r = welcome(hello, { ...ctx, node: null });
    expect(r.isErr() && r.error.code).toBe("unknown-node");
  });

  it("accepts only the node's own proof for exactly this session", () => {
    const w = welcome(hello, ctx);
    expect(authenticate(w.unwrap(), nodeAnswer(w), nodeKey).isOk()).toBe(true);
    for (const bad of [
      nodeAnswer(w, { cpNonce: "b".repeat(64) }),
      nodeAnswer(w, { role: "hub" }),
      nodeAnswer(w, { incarnation: "inc-2" }),
      nodeAnswer(w, {}, new Uint8Array(32).fill(9)),
      { ...nodeAnswer(w), sessionId: "sess-other" },
    ]) {
      expect(authenticate(w.unwrap(), bad, nodeKey).isErr()).toBe(true);
    }
  });
});
