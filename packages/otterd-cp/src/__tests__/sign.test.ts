import {
  MAX_CAPABILITY_TTL_MS,
  capability,
  enrollCertificate,
  leaseRenewal,
  sessionProof,
  verifyAndParse,
} from "@otterdeploy/otterd-proto";
import { describe, expect, test } from "bun:test";

import {
  capabilityFor,
  seedSigner,
  signCapability,
  signEnrollCertificate,
  signHubProof,
  signLease,
} from "../sign";

const signer = seedSigner(new Uint8Array(32).fill(1));
const req = {
  installId: "inst",
  nodeId: "n1",
  nodeEpoch: 2,
  sessionId: "sess-1",
  authorityTerm: 3,
  verb: "workload.apply" as const,
  opId: "op_1",
  operationEpoch: 7,
  payloadHash: "c".repeat(64),
  resourceId: "svc-web",
  now: 1_900_000_000_000,
};

describe("capabilities", () => {
  test("bind node, epoch, session, term, operation, payload and the verb's permissions", () => {
    const env = signCapability(signer, req);
    const cap = verifyAndParse(
      env,
      [signer.publicKey],
      "otterd/capability/v1",
      capability,
    ).unwrap();
    expect(cap).toMatchObject({
      installId: "inst",
      aud: "n1",
      nodeEpoch: 2,
      sessionId: "sess-1",
      authorityTerm: 3,
      verb: "workload.apply",
      opId: "op_1",
      operationEpoch: 7,
      payloadHash: "c".repeat(64),
      resourceId: "svc-web",
      permissions: ["mutate"],
    });
    expect(cap.expiresAtUnixMs - cap.notBeforeUnixMs).toBeLessThanOrEqual(MAX_CAPABILITY_TTL_MS);
    expect(cap.notBeforeUnixMs).toBeLessThan(req.now);
  });

  test("are short-lived even when asked for more, and never reuse a nonce", () => {
    const long = capabilityFor({ ...req, ttlMs: 10 * 60_000 });
    expect(long.expiresAtUnixMs - long.notBeforeUnixMs).toBeLessThanOrEqual(MAX_CAPABILITY_TTL_MS);
    const nonces = new Set(Array.from({ length: 100 }, () => capabilityFor(req).nonce));
    expect(nonces.size).toBe(100);
  });

  test("a capability never verifies as another document", () => {
    const env = signCapability(signer, req);
    expect(verifyAndParse(env, [signer.publicKey], "otterd/lease/v1", leaseRenewal).isErr()).toBe(
      true,
    );
  });
});

test("lease renewals, hub proofs and enrollment certificates verify under their own context", () => {
  const lease = signLease(signer, {
    installId: "inst",
    nodeId: "n1",
    nodeEpoch: 2,
    authorityTerm: 3,
    bootId: "boot",
    incarnation: "inc",
    nonce: "d".repeat(64),
    grants: ["g1"],
  });
  expect(
    verifyAndParse(lease, [signer.publicKey], "otterd/lease/v1", leaseRenewal).unwrap(),
  ).toMatchObject({
    grants: ["g1"],
    durationMs: 20_000,
  });
  const proof = signHubProof(signer, {
    channel: "control",
    protocol: 1,
    installId: "inst",
    sessionId: "sess-1",
    nodeId: "n1",
    nodeEpoch: 2,
    bootId: "boot",
    incarnation: "inc",
    nodeNonce: "a".repeat(64),
    cpNonce: "b".repeat(64),
  });
  expect(
    verifyAndParse(proof, [signer.publicKey], "otterd/session/v1", sessionProof).unwrap().role,
  ).toBe("hub");
  const cert = signEnrollCertificate(signer, {
    installId: "inst",
    nodeId: "n1",
    nodeEpoch: 1,
    authorityTerm: 1,
    roles: ["worker"],
    identityKeyId: "e".repeat(32),
    keyEpoch: 1,
    host: { machineId: "m" },
    cpKeys: [{ key: signer.publicKey, epoch: 1 }],
    recoveryKey: signer.publicKey,
    controlUrl: "wss://cp.example/api/otterd/connect",
    issuedAtUnixMs: 1,
    reason: "enrollment",
  });
  expect(
    verifyAndParse(cert, [signer.publicKey], "otterd/enroll/v1", enrollCertificate).isOk(),
  ).toBe(true);
});
