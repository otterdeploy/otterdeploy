/**
 * Release gaps on a real Postgres: one scheduler leader per install, and the
 * re-enrollment of a fenced node at a new epoch.
 */
import { db } from "@otterdeploy/db";
import { otterdAuthority, otterdNode } from "@otterdeploy/db/schema/otterd";
import { seedSigner } from "@otterdeploy/otterd-cp";
import { enrollCertificate, publicKeyFromSeed, verifyAndParse } from "@otterdeploy/otterd-proto";
import { normalizeServiceSpec, serviceSpecInput } from "@otterdeploy/otterd-proto";
import { Result } from "better-result";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vite-plus/test";

import { Leadership } from "../leader";
import { beginFence, finishFence } from "../store/evidence";
import { admitGrant, markSent } from "../store/grants";
import { releaseGrant } from "../store/grants";
import { beginReenroll, finishReenroll, recoveryWork } from "../store/reenroll";
import { putService } from "../store/services";
import { loadSnapshot } from "../store/snapshot";

const NOW = 1_920_000_000_000;
const run = randomUUID().slice(0, 8);
const signer = seedSigner(new Uint8Array(32).fill(11));
const binding = { provider: "hetzner", serverId: `srv-${run}`, createdAt: "2026-10-13T10:00:00Z" };

describe("scheduler leadership", () => {
  it("is held by one process at a time and passes on when the holder goes", async () => {
    /* oxlint-disable-next-line node/no-process-env -- test boundary: the migrated database's URL */
    const url = process.env.DATABASE_URL ?? "";
    const a = new Leadership(url);
    const b = new Leadership(url);
    expect(await a.check()).toBe(true);
    expect(await b.check()).toBe(false);
    expect(await a.check()).toBe(true);
    await a.release();
    expect(await b.check()).toBe(true);
    expect(await a.check()).toBe(false);
    await b.release();
  });
});

describe("re-enrolling a fenced node", () => {
  const nodeId = `rn-${run}`;
  beforeAll(async () => {
    const [existing] = await db.select().from(otterdAuthority).limit(1);
    if (!existing)
      await db
        .insert(otterdAuthority)
        .values({ installId: `inst-${run}`, authorityTerm: 1, updatedAt: NOW });
    await db.insert(otterdNode).values({
      nodeId,
      ordinal: 9_000_000 + Math.floor(Math.random() * 1e6),
      nodeEpoch: 1,
      keyEpoch: 1,
      identityKey: publicKeyFromSeed(new Uint8Array(32).fill(12)),
      identityKeyId: "1".repeat(32),
      roles: ["worker"],
      labels: {},
      arch: "x86_64",
      host: { machineId: `m-${run}` },
      facts: {},
      allocatableNanoCpus: 2e9,
      allocatableMemoryBytes: 4 * 1024 ** 3,
      fenceAdapter: "hetzner",
      fenceEnabled: true,
      fenceBinding: binding,
      sessionId: `sess-${run}`,
      incarnation: `inc-${run}`,
      bootId: "boot",
      lastEvidenceAt: NOW,
      enrolledAt: NOW,
      updatedAt: NOW,
    });
  });

  const cfg = (anchored: boolean) => ({
    signer,
    controlUrl: "wss://cp.test/api/otterd/connect",
    recoveryKey: publicKeyFromSeed(new Uint8Array(32).fill(13)),
    anchor: anchored ? async () => Result.ok({ result: "committed" as const, seq: 42 }) : null,
  });

  it("refuses without a verified fence, or while a grant of the old epoch is unreleased", async () => {
    const none = await beginReenroll(cfg(false), nodeId, NOW);
    expect(none.isErr() && none.error._tag === "OtterdRefusal" && none.error.reason).toBe(
      "not-fenced",
    );

    const id = `svc-rn-${run}`;
    (
      await putService(
        normalizeServiceSpec(
          serviceSpecInput.parse({
            resourceId: id,
            task: { container: { image: { reference: "alpine" } } },
            lifecycle: { exclusive: true },
          }),
        ),
        NOW,
      )
    ).unwrap();
    const g = (
      await admitGrant({
        resourceId: id,
        slotIndex: 0,
        nodeId,
        exclusive: true,
        surge: false,
        specRevision: 1,
        reason: "t",
        now: NOW,
      })
    ).unwrap();
    (await markSent(g.grantId, NOW)).unwrap();
    const fence = (await beginFence(nodeId, NOW + 1_000, "test")).unwrap();
    // Unreleased grant: refused even with the fence verified.
    (
      await finishFence(
        fence.id,
        {
          evidence: {
            evidenceId: `hetzner_${run}`,
            method: "provider-power-off",
            adapter: "hetzner",
            binding,
            requestedAtUnixMs: NOW + 1_000,
            reference: "action-9",
            observations: [{ atUnixMs: NOW + 5_000, status: "off" }],
            verifiedOffAtUnixMs: NOW + 5_000,
            detail: {},
          },
        },
        NOW + 5_000,
      )
    ).unwrap();
    const held = await beginReenroll(cfg(false), nodeId, NOW + 6_000);
    expect(held.isErr() && held.error._tag === "OtterdRefusal" && held.error.reason).toBe(
      "grants-unresolved",
    );
    expect(
      (await loadSnapshot(NOW + 6_000)).unwrap().retirements.some((r) => r.grantId === g.grantId),
    ).toBe(true);
    (await releaseGrant(g.grantId, NOW + 6_000)).unwrap();
  });

  it("raises the epoch after the anchor commit and hands the old one a single recovery session", async () => {
    const r = (await beginReenroll(cfg(true), nodeId, NOW + 7_000)).unwrap();
    expect(r.nodeEpoch).toBe(2);
    const [row] = await db.select().from(otterdNode).where(eq(otterdNode.nodeId, nodeId));
    expect(row).toMatchObject({ nodeEpoch: 2, recoveryEpoch: 1, anchorSeq: 42, sessionId: null });
    const work = (await recoveryWork(nodeId, 1)).unwrap();
    expect(work?.barrier).toMatchObject({
      method: "provider-power-off",
      nodeEpoch: 1,
      providerActionId: "action-9",
    });
    const cert = verifyAndParse(
      work?.certificate ?? {
        context: "otterd/enroll/v1",
        keyId: "0".repeat(32),
        payload: "",
        signature: "x".repeat(86) + "==",
      },
      [signer.publicKey],
      "otterd/enroll/v1",
      enrollCertificate,
    ).unwrap();
    expect(cert).toMatchObject({ nodeId, nodeEpoch: 2, identityKeyId: "1".repeat(32) });
    expect((await recoveryWork(nodeId, 2)).unwrap()).toBeNull();
    const again = await beginReenroll(cfg(true), nodeId, NOW + 8_000);
    expect(again.isErr() && again.error._tag === "OtterdRefusal" && again.error.reason).toBe(
      "reenroll-pending",
    );
    (await finishReenroll(nodeId, 1, NOW + 9_000)).unwrap();
    const [after] = await db.select().from(otterdNode).where(eq(otterdNode.nodeId, nodeId));
    expect(after).toMatchObject({ nodeEpoch: 2, recoveryEpoch: null, reenrollCertificate: null });
    expect((await recoveryWork(nodeId, 1)).unwrap()).toBeNull();
  });
});
