/**
 * The otterd scheduler store on a real Postgres: admission under the slot
 * lock, the partial unique index that keeps one live grant per exclusive
 * slot, release only on verified evidence (a node-signed stop certificate or
 * a fence that followed the revocation), slot reports, and the snapshot.
 */
import { db } from "@otterdeploy/db";
import { otterdAuthority, otterdGrant, otterdNode } from "@otterdeploy/db/schema/otterd";
import { plan } from "@otterdeploy/otterd-cp";
import {
  normalizeServiceSpec,
  publicKeyFromSeed,
  serviceSpecInput,
  signEnvelope,
} from "@otterdeploy/otterd-proto";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vite-plus/test";

import { adoptGrant } from "../store/adopt";
import { beginFence, finishFence, recordStopCertificate } from "../store/evidence";
import { admitGrant, markGrant, markSent, releaseGrant } from "../store/grants";
import { applySlotReports } from "../store/reports";
import { putService } from "../store/services";
import { loadSnapshot } from "../store/snapshot";

const NOW = 1_910_000_000_000;
const seed = new Uint8Array(32).fill(5);
const run = randomUUID().slice(0, 8);
const binding = { provider: "hetzner", serverId: `srv-${run}`, createdAt: "2026-10-13T10:00:00Z" };
let installId = "";

async function seedNode(nodeId: string, ordinal: number): Promise<void> {
  await db.insert(otterdNode).values({
    nodeId,
    ordinal,
    nodeEpoch: 1,
    keyEpoch: 1,
    identityKey: publicKeyFromSeed(seed),
    identityKeyId: "0".repeat(32),
    roles: ["worker"],
    labels: {},
    arch: "x86_64",
    host: {},
    facts: {},
    allocatableNanoCpus: 4_000_000_000,
    allocatableMemoryBytes: 8 * 1024 ** 3,
    fenceAdapter: "hetzner",
    fenceEnabled: true,
    fenceBinding: binding,
    sessionId: `sess-${nodeId}`,
    incarnation: `inc-${nodeId}`,
    bootId: "boot-1",
    lastEvidenceAt: NOW,
    enrolledAt: NOW,
    updatedAt: NOW,
  });
}

const spec = (resourceId: string, exclusive: boolean, image = "alpine:3.20") =>
  normalizeServiceSpec(
    serviceSpecInput.parse({
      resourceId,
      task: { container: { image: { reference: image } } },
      lifecycle: { exclusive, failoverPolicy: "reschedule", failoverDelayMs: 30_000 },
    }),
  );

const issue = (resourceId: string, nodeId: string, exclusive: boolean) =>
  admitGrant({
    resourceId,
    slotIndex: 0,
    nodeId,
    exclusive,
    surge: false,
    specRevision: 1,
    reason: "test",
    now: NOW,
  });

function certificate(
  g: { grantId: string; resourceId: string; nodeId: string },
  attemptIds: string[],
) {
  const body = {
    installId,
    nodeId: g.nodeId,
    nodeEpoch: 1,
    slot: { resourceId: g.resourceId, index: 0 },
    grantId: g.grantId,
    opId: "op1",
    attemptIds,
    containers: [{ container: "c1", process: { state: "exited", exitCode: 0 } }],
    cgroupsEmpty: true,
    mutationInventoryDigest: "b".repeat(64),
    mutationCount: 2,
    bootId: "boot-1",
    issuedAtUnixMs: NOW + 1_000,
  };
  return signEnvelope(
    seed,
    "otterd/stop-certificate/v1",
    new TextEncoder().encode(JSON.stringify(body)),
  );
}

describe("otterd scheduler store", () => {
  const n1 = `n1-${run}`;
  const n2 = `n2-${run}`;
  beforeAll(async () => {
    const [existing] = await db.select().from(otterdAuthority).limit(1);
    if (existing) installId = existing.installId;
    else {
      installId = `inst-${run}`;
      await db.insert(otterdAuthority).values({ installId, authorityTerm: 1, updatedAt: NOW });
    }
    await seedNode(n1, 1_000 + Math.floor(Math.random() * 1e6));
    await seedNode(n2, 2_000_000 + Math.floor(Math.random() * 1e6));
  });

  it("keeps one revision per distinct spec", async () => {
    const id = `svc-rev-${run}`;
    expect((await putService(spec(id, false), NOW)).unwrap()).toBe(1);
    expect((await putService(spec(id, false), NOW)).unwrap()).toBe(1);
    expect((await putService(spec(id, false, "alpine:3.21"), NOW)).unwrap()).toBe(2);
  });

  it("admits one live grant per exclusive slot, with rising generations, enforced by Postgres too", async () => {
    const id = `svc-db-${run}`;
    (await putService(spec(id, true), NOW)).unwrap();
    const first = (await issue(id, n1, true)).unwrap();
    expect(first).toMatchObject({
      generation: 1,
      state: "prepared",
      authorityTerm: expect.any(Number),
    });
    const second = await issue(id, n2, true);
    expect(second.isErr() && second.error._tag === "OtterdRefusal" && second.error.reason).toBe(
      "exclusive-slot-held",
    );

    // Bypass the code: the partial unique index still refuses a second live grant.
    const raw = db.insert(otterdGrant).values({ ...first, grantId: `raw-${run}`, generation: 99 });
    await expect(raw).rejects.toThrow();

    // A Prepared grant that never left cancels; then a new generation is admitted.
    (await releaseGrant(first.grantId, NOW)).unwrap();
    expect((await issue(id, n2, true)).unwrap().generation).toBe(2);
  });

  it("never releases a sent grant on silence, revocation or a stop request alone", async () => {
    const id = `svc-silent-${run}`;
    (await putService(spec(id, true), NOW)).unwrap();
    const g = (await issue(id, n1, true)).unwrap();
    (await markSent(g.grantId, NOW)).unwrap();
    for (const mark of ["revoke", "stop"] as const) {
      (await markGrant(g.grantId, mark, NOW, "test")).unwrap();
      const r = await releaseGrant(g.grantId, NOW);
      expect(r.isErr() && r.error._tag === "OtterdRefusal" && r.error.reason).toBe("no-evidence");
    }
  });

  it("releases on a stop certificate covering every reported attempt", async () => {
    const id = `svc-cert-${run}`;
    (await putService(spec(id, true), NOW)).unwrap();
    const g = (await issue(id, n1, true)).unwrap();
    (await markSent(g.grantId, NOW)).unwrap();
    const report = (attempts: string[], state: "running" | "exited") => ({
      slot: { resourceId: id, index: 0 },
      grantId: g.grantId,
      generation: 1,
      state: "running" as const,
      quarantined: false,
      revoked: false,
      attempts: attempts.map((attemptId, i) => ({
        attemptId,
        ordinal: i + 1,
        process: state === "running" ? { state, pid: 7 } : { state, exitCode: 0 },
        mutations: [],
      })),
    });
    expect(
      (await applySlotReports(n1, `sess-${n1}`, [report(["att_a"], "running")], NOW)).unwrap(),
    ).toBe(2);
    (
      await applySlotReports(n1, `sess-${n1}`, [report(["att_a", "att_b"], "running")], NOW + 1)
    ).unwrap();
    const [row] = await db.select().from(otterdGrant).where(eq(otterdGrant.grantId, g.grantId));
    expect(row).toMatchObject({
      state: "running",
      attempts: ["att_a", "att_b"],
      runningSince: NOW,
    });

    (await markGrant(g.grantId, "stop", NOW, "test")).unwrap();
    const partial = await recordStopCertificate(g.grantId, certificate(g, ["att_a"]), NOW);
    expect(partial.isErr() && partial.error._tag === "OtterdRefusal" && partial.error.reason).toBe(
      "certificate-incomplete",
    );
    (await recordStopCertificate(g.grantId, certificate(g, ["att_a", "att_b"]), NOW)).unwrap();
    expect((await releaseGrant(g.grantId, NOW + 2)).unwrap()).toMatchObject({ state: "released" });
  });

  it("releases on a fence only when the evidence followed the revocation and names the machine", async () => {
    const node = `n3-${run}`;
    await seedNode(node, 3_000_000 + Math.floor(Math.random() * 1e6));
    const id = `svc-fence-${run}`;
    (await putService(spec(id, true), NOW)).unwrap();
    const g = (await issue(id, node, true)).unwrap();
    (await markSent(g.grantId, NOW)).unwrap();
    const evidence = (over: object) => ({
      evidenceId: `hetzner_${randomUUID().slice(0, 8)}`,
      method: "provider-power-off" as const,
      adapter: "hetzner",
      binding,
      requestedAtUnixMs: NOW + 5_000,
      reference: "action-1",
      observations: [{ atUnixMs: NOW + 9_000, status: "off" }],
      verifiedOffAtUnixMs: NOW + 9_000,
      detail: {},
      ...over,
    });
    const early = (await beginFence(node, NOW + 5_000, "test")).unwrap();
    const wrongMachine = await finishFence(
      early.id,
      { evidence: evidence({ binding: { ...binding, serverId: "other" } }) },
      NOW + 9_000,
    );
    expect(wrongMachine.unwrap().state).toBe("failed");
    expect((await releaseGrant(g.grantId, NOW + 9_000)).isErr()).toBe(true);

    const fence = (await beginFence(node, NOW + 10_000, "test")).unwrap();
    const tooEarly = await finishFence(
      fence.id,
      { evidence: evidence({ requestedAtUnixMs: NOW + 1_000 }) },
      NOW + 11_000,
    );
    expect(tooEarly.unwrap().state).toBe("failed");

    const ok = (await beginFence(node, NOW + 12_000, "test")).unwrap();
    const done = await finishFence(
      ok.id,
      {
        evidence: evidence({
          requestedAtUnixMs: NOW + 12_000,
          observations: [{ atUnixMs: NOW + 15_000, status: "off" }],
          verifiedOffAtUnixMs: NOW + 15_000,
        }),
      },
      NOW + 15_000,
    );
    expect(done.unwrap().state).toBe("succeeded");
    const snap = (await loadSnapshot(NOW + 16_000)).unwrap();
    expect(snap.retirements.find((r) => r.grantId === g.grantId)).toMatchObject({
      kind: "provider-power-off",
    });
    expect((await releaseGrant(g.grantId, NOW + 16_000)).unwrap().state).toBe("released");
  });

  it("refuses a grant to a node without a control session", async () => {
    const id = `svc-offline-${run}`;
    (await putService(spec(id, false), NOW)).unwrap();
    await db.update(otterdNode).set({ sessionId: null }).where(eq(otterdNode.nodeId, n2));
    const r = await issue(id, n2, false);
    expect(r.isErr() && r.error._tag === "OtterdRefusal" && r.error.reason).toBe(
      "node-not-connected",
    );
  });

  it("adopts a held attempt after a restart: the old grant hands over, the new one takes the same attempt", async () => {
    const node = `n4-${run}`;
    await seedNode(node, 4_000_000 + Math.floor(Math.random() * 1e6));
    const id = `svc-adopt-${run}`;
    (await putService(spec(id, true), NOW)).unwrap();
    const g = (await issue(id, node, true)).unwrap();
    (await markSent(g.grantId, NOW)).unwrap();
    const held = {
      slot: { resourceId: id, index: 0 },
      grantId: g.grantId,
      generation: 1,
      state: "running" as const,
      quarantined: true,
      revoked: false,
      attempts: [
        {
          attemptId: "att_held",
          ordinal: 1,
          process: { state: "unknown" as const, reason: "paused" },
          mutations: [],
        },
      ],
      held: { attemptId: "att_held", paused: true },
    };
    // Before the node's new process reconnects there is nothing to adopt.
    expect((await adoptGrant(g.grantId, "att_held", NOW)).isErr()).toBe(true);
    await db
      .update(otterdNode)
      .set({ incarnation: `inc-${node}-2` })
      .where(eq(otterdNode.nodeId, node));
    (await applySlotReports(node, `sess-${node}`, [held], NOW + 1)).unwrap();
    const snap = (await loadSnapshot(NOW + 2)).unwrap();
    expect(snap.grants.find((x) => x.grantId === g.grantId)?.held).toEqual({
      attemptId: "att_held",
      paused: true,
    });
    expect(
      plan({
        ...snap,
        grants: snap.grants.filter((x) => x.resourceId === id),
        services: snap.services.filter((x) => x.resourceId === id),
      })[0],
    ).toMatchObject({ kind: "adopt", grantId: g.grantId, attemptId: "att_held" });

    expect((await adoptGrant(g.grantId, "att_other", NOW + 3)).isErr()).toBe(true);
    const next = (await adoptGrant(g.grantId, "att_held", NOW + 3)).unwrap();
    expect(next).toMatchObject({
      generation: 2,
      adoptsAttempt: "att_held",
      incarnation: `inc-${node}-2`,
      state: "prepared",
    });
    const [old] = await db.select().from(otterdGrant).where(eq(otterdGrant.grantId, g.grantId));
    expect(old).toMatchObject({
      state: "released",
      releaseEvidenceId: `adopted-by:${next.grantId}`,
    });
    // A second adoption of the same old grant is refused.
    expect((await adoptGrant(g.grantId, "att_held", NOW + 4)).isErr()).toBe(true);
  });

  it("never adopts a revoked held grant", async () => {
    const node = `n5-${run}`;
    await seedNode(node, 5_000_000 + Math.floor(Math.random() * 1e6));
    const id = `svc-adopt-revoked-${run}`;
    (await putService(spec(id, true), NOW)).unwrap();
    const g = (await issue(id, node, true)).unwrap();
    (await markSent(g.grantId, NOW)).unwrap();
    (await markGrant(g.grantId, "revoke", NOW, "node down past the failover delay")).unwrap();
    await db
      .update(otterdGrant)
      .set({ heldAttempt: "att_held" })
      .where(eq(otterdGrant.grantId, g.grantId));
    await db
      .update(otterdNode)
      .set({ incarnation: `inc-${node}-2` })
      .where(eq(otterdNode.nodeId, node));
    const r = await adoptGrant(g.grantId, "att_held", NOW + 1);
    expect(r.isErr() && r.error._tag === "OtterdRefusal" && r.error.reason).toBe("not-adoptable");
  });
});
