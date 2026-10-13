/**
 * The node network's control-plane side on a real Postgres: a grant takes
 * its scope network, attempt address and the service's VIP in the admitting
 * transaction; a released address waits for every node that was told about
 * it (a matching drain acknowledgement or a fence frees it); the plan is
 * written with an optimistic revision check; edge routes dial the VIP.
 */
import { db } from "@otterdeploy/db";
import {
  otterdAuthority,
  otterdGrant,
  otterdNode,
  otterdService,
} from "@otterdeploy/db/schema/otterd";
import { ipam } from "@otterdeploy/otterd-cp";
import {
  type ServiceSpec,
  normalizeServiceSpec,
  publicKeyFromSeed,
  serviceSpecInput,
  signEnvelope,
} from "@otterdeploy/otterd-proto";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vite-plus/test";

import { buildHttpBlock } from "../../caddy/builder";
import { withServiceVips } from "../../caddy/service-vips";
import { run as transaction } from "../store/errors";
import { recordStopCertificate } from "../store/evidence";
import { admitGrant, markGrant, markSent, releaseGrant } from "../store/grants";
import { fenceNetworkPeer } from "../store/network";
import { readPlan, writePlan } from "../store/plan-row";
import { applySlotReports } from "../store/reports";
import { putService } from "../store/services";
import { markServingSent, recordServing, servingTargets } from "../store/serving";
import { acknowledgeAuthority } from "../store/serving-ack";
import { databaseToSpec } from "../translate";

const NOW = 1_950_000_000_000;
const seed = new Uint8Array(32).fill(9);
const run = randomUUID().slice(0, 8);
const scope = `scope-${run}`;
const n1 = `neta-${run}`;
const n2 = `netb-${run}`;
const n3 = `netc-${run}`;
const byText = (a: string, b: string) => a.localeCompare(b);
let installId = "";

async function seedNode(nodeId: string): Promise<void> {
  await db.insert(otterdNode).values({
    nodeId,
    ordinal: 30_000_000 + Math.floor(Math.random() * 1e7),
    nodeEpoch: 1,
    keyEpoch: 1,
    identityKey: publicKeyFromSeed(seed),
    identityKeyId: "9".repeat(32),
    roles: ["worker"],
    labels: {},
    arch: "x86_64",
    host: {},
    facts: {},
    allocatableNanoCpus: 4e9,
    allocatableMemoryBytes: 8 * 1024 ** 3,
    sessionId: `sess-${nodeId}`,
    incarnation: `inc-${nodeId}`,
    bootId: "boot-1",
    lastEvidenceAt: NOW,
    enrolledAt: NOW,
    updatedAt: NOW,
  });
}

const web = (resourceId: string): ServiceSpec =>
  normalizeServiceSpec(
    serviceSpecInput.parse({
      resourceId,
      mode: { kind: "replicated", replicas: 2 },
      task: { container: { image: { reference: "nginx:1.27" }, stopGraceMs: 5_000 } },
      endpoint: { ports: [{ targetPort: 8080 }], aliases: ["web"], scopes: [scope] },
    }),
  );

const admit = (resourceId: string, slotIndex: number, nodeId: string) =>
  admitGrant({
    resourceId,
    slotIndex,
    nodeId,
    exclusive: false,
    surge: false,
    specRevision: 1,
    reason: "test",
    now: NOW,
  });

/** Admit, send and report one running attempt for slot 0 on n1. */
async function running(resourceId: string, attemptId: string) {
  const g = (await admit(resourceId, 0, n1)).unwrap();
  (await markSent(g.grantId, NOW)).unwrap();
  const report = {
    slot: { resourceId, index: 0 },
    grantId: g.grantId,
    generation: g.generation,
    state: "running" as const,
    quarantined: false,
    revoked: false,
    attempts: [
      { attemptId, ordinal: 1, process: { state: "running" as const, pid: 7 }, mutations: [] },
    ],
  };
  (await applySlotReports(n1, `sess-${n1}`, [report], NOW + 1)).unwrap();
  return g;
}

function certificate(g: { grantId: string; resourceId: string }, attemptIds: string[]) {
  const body = {
    installId,
    nodeId: n1,
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

/** Publish the service's current set to the peers; returns the digest they were sent. */
async function tell(resourceId: string, peers: string[]) {
  const target = (await servingTargets()).unwrap().find((t) => t.resourceId === resourceId);
  if (!target) throw new Error("no serving target");
  const row = (await recordServing(target, NOW + 2)).unwrap();
  const digest = `${run}`.padEnd(64, "d").replace(/[^0-9a-f]/g, "e");
  for (const p of peers) {
    (
      await markServingSent(resourceId, p, `sess-${p}`, { revision: row.revision, digest })
    ).unwrap();
  }
  return { vipId: target.vipId, revision: row.revision, digest };
}

async function stopAndRelease(g: { grantId: string; resourceId: string }, attempts: string[]) {
  (await markGrant(g.grantId, "stop", NOW, "test")).unwrap();
  (await recordStopCertificate(g.grantId, certificate(g, attempts), NOW + 3)).unwrap();
  (await releaseGrant(g.grantId, NOW + 4)).unwrap();
}

const held = async (address: string) => {
  const plan = (await transaction((tx) => readPlan(tx))).unwrap().plan;
  return plan.quarantine.find(
    (q) => q.held.kind === "endpoint" && ipam.formatAddr(q.held.addr) === address,
  );
};

const ack = (
  nodeId: string,
  sent: { vipId: string; revision: number; digest: string },
  drained?: string[],
) =>
  acknowledgeAuthority(
    nodeId,
    {
      type: "authorityAck",
      context: "otterd/serving-set/v1",
      documentDigest: sent.digest,
      vipId: sent.vipId,
      servingRevision: sent.revision,
      ...(drained ? { drainedAttempts: drained } : {}),
    },
    NOW + 5,
  );

describe("otterd node network state", () => {
  beforeAll(async () => {
    const [existing] = await db.select().from(otterdAuthority).limit(1);
    if (existing) installId = existing.installId;
    else {
      installId = `inst-${run}`;
      await db.insert(otterdAuthority).values({ installId, authorityTerm: 1, updatedAt: NOW });
    }
    for (const n of [n1, n2, n3]) await seedNode(n);
  });

  it("a grant carries its scope network, address, resolver, zone and the service's one VIP", async () => {
    const id = `net-web-${run}`;
    (await putService(web(id), NOW, `od-p${run}-web`)).unwrap();
    const a = (await admit(id, 0, n1)).unwrap();
    const b = (await admit(id, 1, n1)).unwrap();
    expect(a.network).toMatchObject({
      scopeId: scope,
      zone: `${scope}.otd.internal`,
      resolver: expect.stringMatching(/^172\.30\.(22[89]|23[01])\./),
      vip: { vipId: `vip.${id}`, address: expect.stringMatching(/^172\.31\./) },
    });
    const subnet = ipam.parseNet(a.network?.subnet ?? "").unwrap();
    expect(subnet.len).toBe(27);
    for (const g of [a, b]) {
      const addr = ipam.parseAddr(g.network?.address ?? "") ?? 0;
      expect(ipam.covers(subnet, { addr, len: 32 })).toBe(true);
    }
    expect(b.network?.address).not.toBe(a.network?.address);
    expect(b.network?.vip).toEqual(a.network?.vip);
    const [svc] = await db.select().from(otterdService).where(eq(otterdService.resourceId, id));
    expect(svc?.vipAddress).toBe(a.network?.vip?.address);
  });

  it("an address no other node was told about is free again when its grant is released", async () => {
    const id = `net-free-${run}`;
    (await putService(web(id), NOW)).unwrap();
    const g = (await admit(id, 0, n2)).unwrap();
    (await releaseGrant(g.grantId, NOW)).unwrap();
    const address = g.network?.address ?? "";
    expect(await held(address)).toBeUndefined();
    const plan = (await transaction((tx) => readPlan(tx))).unwrap().plan;
    const live = [...plan.endpoints.values()].some((e) =>
      e.live.has(ipam.parseAddr(address) ?? -1),
    );
    expect(live).toBe(false);
    const [row] = await db.select().from(otterdGrant).where(eq(otterdGrant.grantId, g.grantId));
    expect(row?.networkReleasedAt).toBe(NOW);
  });

  it("a released address waits for every node told about it: a matching drain ack or a fence frees it", async () => {
    const id = `net-peers-${run}`;
    (await putService(web(id), NOW)).unwrap();
    const g = await running(id, `att-p-${run}`);
    const sent = await tell(id, [n2, n3]);
    await stopAndRelease(g, [`att-p-${run}`]);
    const address = g.network?.address ?? "";
    expect([...((await held(address))?.awaiting ?? [])].sort(byText)).toEqual(
      [n2, n3].sort(byText),
    );

    // An acknowledgement must name the exact document that node was sent.
    expect((await ack(n2, { ...sent, digest: "f".repeat(64) }, [`att-p-${run}`])).unwrap()).toBe(0);
    expect([...((await held(address))?.awaiting ?? [])].sort(byText)).toEqual(
      [n2, n3].sort(byText),
    );
    expect((await ack(n2, sent, [`att-p-${run}`])).unwrap()).toBe(0);
    expect([...((await held(address))?.awaiting ?? [])]).toEqual([n3]);

    // n3 never answers: only a fence lets the address go.
    (await transaction((tx) => fenceNetworkPeer(tx, n3, NOW + 6))).unwrap();
    expect(await held(address)).toBeUndefined();
  });

  it("an unchanged set keeps its revision, whatever order Postgres returns its keys in", async () => {
    const id = `net-steady-${run}`;
    (await putService(web(id), NOW)).unwrap();
    await running(id, `att-s-${run}`);
    const target = (await servingTargets()).unwrap().find((t) => t.resourceId === id);
    if (!target) throw new Error("no serving target");
    const first = (await recordServing(target, NOW + 2)).unwrap();
    const again = (await recordServing(target, NOW + 3)).unwrap();
    expect(again.revision).toBe(first.revision);
  });

  it("a drain acknowledged before the release takes that node out of the wait", async () => {
    const id = `net-early-${run}`;
    (await putService(web(id), NOW)).unwrap();
    const g = await running(id, `att-e-${run}`);
    const sent = await tell(id, [n2]);
    (await ack(n2, sent)).unwrap();
    (await ack(n2, sent, [`att-e-${run}`])).unwrap();
    await stopAndRelease(g, [`att-e-${run}`]);
    expect(await held(g.network?.address ?? "")).toBeUndefined();
  });

  it("refuses a plan write when another writer committed since it was read", async () => {
    let release = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const stale = transaction(async (tx) => {
      const loaded = await readPlan(tx);
      await gate;
      await writePlan(tx, loaded, NOW);
    });
    await new Promise((r) => setTimeout(r, 50));
    (await transaction(async (tx) => writePlan(tx, await readPlan(tx), NOW))).unwrap();
    release();
    const r = await stale;
    expect(r.isErr() && r.error._tag === "OtterdRefusal" && r.error.reason).toBe(
      "address-plan-moved",
    );
  });

  it("an edge route to an otterd service dials its VIP", async () => {
    const name = `od-p${run}-web`;
    const [svc] = await db.select().from(otterdService).where(eq(otterdService.serviceName, name));
    const [route] = await withServiceVips([
      {
        projectId: "prj_1",
        type: "http",
        domain: "web.example.com",
        upstreamHost: name,
        upstreamPort: 8080,
        protocol: "http",
        layer4Alpn: null,
        usesAcme: false,
      },
    ]);
    expect(route?.upstreamVip).toBe(svc?.vipAddress);
    expect(route && buildHttpBlock(route)).toContain(`${svc?.vipAddress}:8080`);
  });

  it("a public database route dials the database's VIP, found by its internal hostname", async () => {
    const id = `net-db-${run}`;
    const db1 = databaseToSpec(
      {
        engine: "postgres",
        resourceId: id,
        serviceName: `od-p${run}-db`,
        volumeName: `otterdeploy-pg-${run}`,
        hostnameAlias: `db-${run}.otterdeploy.internal`,
        databaseName: "app",
        username: "app",
        password: "pw",
        projectSlug: `p${run}`,
        networkScopeSuffix: "",
        deploymentId: "dep_1",
      },
      { nodeId: null },
    ).unwrap();
    (await putService({ ...db1, endpoint: { ...db1.endpoint, scopes: [scope] } }, NOW)).unwrap();
    const g = (
      await admitGrant({
        resourceId: id,
        slotIndex: 0,
        nodeId: n1,
        exclusive: true,
        surge: false,
        specRevision: 1,
        reason: "test",
        now: NOW,
      })
    ).unwrap();
    const vip = g.network?.vip?.address;
    expect(vip).toMatch(/^172\.31\./);
    const [route] = await withServiceVips([
      {
        projectId: "prj_1",
        type: "layer4",
        domain: "db.example.com",
        upstreamHost: `db-${run}.otterdeploy.internal`,
        upstreamPort: 5432,
        protocol: "tcp",
        layer4Alpn: "postgresql",
        usesAcme: false,
      },
    ]);
    expect(route?.upstreamVip).toBe(vip);
  });
});
