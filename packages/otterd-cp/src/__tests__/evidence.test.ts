import { publicKeyFromSeed, signEnvelope } from "@otterdeploy/otterd-proto";
import { describe, expect, test } from "bun:test";

import {
  acceptFence,
  barrierRetires,
  type FenceEvidence,
  verifyStopCertificate,
} from "../evidence";

const nodeSeed = new Uint8Array(32).fill(7);
const nodeKey = publicKeyFromSeed(nodeSeed);
const DIGEST = "a".repeat(64);

const cert = (over: Record<string, unknown> = {}) => ({
  installId: "inst",
  nodeId: "n1",
  nodeEpoch: 3,
  slot: { resourceId: "svc-db", index: 0 },
  grantId: "g1",
  opId: "op1",
  attemptIds: ["att_1", "att_2"],
  containers: [{ container: "c1", process: { state: "exited", exitCode: 0 } }],
  cgroupsEmpty: true,
  mutationInventoryDigest: DIGEST,
  mutationCount: 4,
  bootId: "boot-1",
  issuedAtUnixMs: 1_900_000_000_000,
  ...over,
});
const signed = (c: object, seed = nodeSeed) =>
  signEnvelope(seed, "otterd/stop-certificate/v1", new TextEncoder().encode(JSON.stringify(c)));
const expectation = {
  installId: "inst",
  nodeId: "n1",
  nodeEpoch: 3,
  identityKey: nodeKey,
  grantId: "g1",
  slot: { resourceId: "svc-db", index: 0 },
  knownAttemptIds: ["att_1", "att_2"],
};

describe("stop certificates", () => {
  test("a complete certificate from the node's key verifies", () => {
    expect(verifyStopCertificate(signed(cert()), expectation).unwrap().grantId).toBe("g1");
  });

  test.each([
    ["another key", signed(cert(), new Uint8Array(32).fill(9)), "signature"],
    ["another grant", signed(cert({ grantId: "g2" })), "binding"],
    ["another epoch", signed(cert({ nodeEpoch: 2 })), "binding"],
    ["another slot", signed(cert({ slot: { resourceId: "svc-db", index: 1 } })), "binding"],
    ["a missed attempt", signed(cert({ attemptIds: ["att_1"] })), "incomplete"],
    [
      "a running container",
      signed(cert({ containers: [{ container: "c1", process: { state: "running", pid: 9 } }] })),
      "not-stopped",
    ],
    [
      "an unknown container",
      signed(
        cert({ containers: [{ container: "c1", process: { state: "unknown", reason: "hung" } }] }),
      ),
      "not-stopped",
    ],
    ["a populated cgroup", signed(cert({ cgroupsEmpty: false })), "not-stopped"],
  ] as const)("refuses %s", (_, envelope, code) => {
    const r = verifyStopCertificate(envelope, expectation);
    expect(r.isErr() && r.error.code).toBe(code);
  });

  test("a certificate signed under another context does not verify", () => {
    const wrong = signEnvelope(
      nodeSeed,
      "otterd/lease/v1",
      new TextEncoder().encode(JSON.stringify(cert())),
    );
    expect(verifyStopCertificate(wrong, expectation).isErr()).toBe(true);
  });
});

describe("fence evidence", () => {
  const binding = { provider: "hetzner", serverId: "42", createdAt: "2026-10-13T10:00:00Z" };
  const ev = (over: Partial<FenceEvidence> = {}): FenceEvidence => ({
    evidenceId: "hetzner_1",
    method: "provider-power-off",
    adapter: "hetzner",
    binding,
    requestedAtUnixMs: 2_000,
    reference: "action-77",
    observations: [
      { atUnixMs: 9_000, status: "off" },
      { atUnixMs: 10_000, status: "off" },
    ],
    verifiedOffAtUnixMs: 10_000,
    detail: {},
    ...over,
  });
  const exp = { nodeEpoch: 3, binding, revokedAt: 1_000 };

  test("a verified provider power-off becomes barrier evidence for the node epoch", () => {
    expect(acceptFence(ev(), exp).unwrap()).toEqual({
      evidenceId: "hetzner_1",
      method: "provider-power-off",
      adapter: "hetzner",
      providerActionId: "action-77",
      nodeEpoch: 3,
      observedAtUnixMs: 10_000,
    });
  });

  test("refuses another machine, a fence before revocation, and no off reading", () => {
    expect(acceptFence(ev({ binding: { ...binding, serverId: "43" } }), exp).isErr()).toBe(true);
    expect(
      acceptFence(ev({ binding: { ...binding, createdAt: "2026-10-14T00:00:00Z" } }), exp).isErr(),
    ).toBe(true);
    expect(acceptFence(ev({ requestedAtUnixMs: 500 }), exp).isErr()).toBe(true);
    expect(
      acceptFence(ev({ observations: [{ atUnixMs: 9_000, status: "running" }] }), exp).isErr(),
    ).toBe(true);
    expect(
      acceptFence(ev({ observations: [{ atUnixMs: 1_500, status: "off" }] }), exp).isErr(),
    ).toBe(true);
  });

  test("a manual fence must name who asserted it", () => {
    const manual = ev({ method: "manual-fence", adapter: "manual", observations: [] });
    expect(acceptFence(manual, exp).isErr()).toBe(true);
    expect(acceptFence({ ...manual, assertedBy: "admin@example.com" }, exp).unwrap()).toMatchObject(
      {
        method: "manual-fence",
        assertedBy: "admin@example.com",
      },
    );
  });

  test("a barrier retires only revoked grants of its epoch issued before it was observed", () => {
    const barrier = acceptFence(ev(), exp).unwrap();
    const g = { nodeEpoch: 3, sentAt: 500, revoked: true, revokedAt: 1_000 };
    expect(barrierRetires(barrier, g)).toBe(true);
    expect(barrierRetires(barrier, { ...g, revoked: false, revokedAt: null })).toBe(false);
    expect(barrierRetires(barrier, { ...g, nodeEpoch: 4 })).toBe(false);
    expect(barrierRetires(barrier, { ...g, sentAt: 11_000 })).toBe(false);
  });
});
