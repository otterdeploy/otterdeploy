/**
 * Enrollment on a real Postgres: proof of possession, single-use tokens,
 * append-before-capability through the anchor, and the certificate.
 */
import { db } from "@otterdeploy/db";
import { otterdAuthority, otterdNode } from "@otterdeploy/db/schema/otterd";
import { resource } from "@otterdeploy/db/schema/project";
import { server } from "@otterdeploy/db/schema/server";
import { seedSigner } from "@otterdeploy/otterd-cp";
import {
  enrollCertificate,
  keyIdOf,
  publicKeyFromSeed,
  signEnvelope,
  verifyAndParse,
} from "@otterdeploy/otterd-proto";
import { Result } from "better-result";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vite-plus/test";

import type { NodeRecord } from "../tools";

import { seedOrganization, seedProject, seedService } from "../../__tests__/postgres-seed";
import { type RegistryConfig, createEnrollToken, enroll } from "../registry";
import { pinOf } from "../store/status";

const NOW = 1_910_000_000_000;
const signer = seedSigner(new Uint8Array(32).fill(3));
const nodeSeed = new Uint8Array(32).fill(4);
const run = randomUUID().slice(0, 8);

function request(token: string, seed = nodeSeed, signWith = seed) {
  const body = {
    token,
    nonce: "a".repeat(64),
    keys: {
      keyEpoch: 1,
      identity: publicKeyFromSeed(seed),
      cacheEncryption: publicKeyFromSeed(new Uint8Array(32).fill(8)),
      wireguard: publicKeyFromSeed(new Uint8Array(32).fill(9)),
    },
    host: { machineId: `m-${run}` },
    facts: {
      hostname: `W1.${run}`,
      arch: "x86_64",
      osId: "ubuntu",
      osVersion: "24.04",
      kernel: "6.8",
      cpuCores: 2,
      memoryBytes: 4 * 1024 ** 3,
    },
    requestedRoles: ["worker"],
    otterdVersion: "0.1.0",
  };
  return signEnvelope(
    signWith,
    "otterd/enroll-request/v1",
    new TextEncoder().encode(JSON.stringify(body)),
  );
}

const appended: NodeRecord[] = [];
const cfg = (anchor: RegistryConfig["anchor"]): RegistryConfig => ({
  signer,
  controlUrl: "wss://cp.test/api/otterd/connect",
  recoveryKey: publicKeyFromSeed(new Uint8Array(32).fill(6)),
  anchor,
});
const committed: RegistryConfig["anchor"] = async (node) => {
  appended.push(node);
  return Result.ok({ result: "committed", seq: appended.length });
};

describe("otterd enrollment", () => {
  beforeAll(async () => {
    const [existing] = await db.select().from(otterdAuthority).limit(1);
    if (!existing)
      await db
        .insert(otterdAuthority)
        .values({ installId: `inst-${run}`, authorityTerm: 1, updatedAt: NOW });
  });

  const token = async () =>
    (
      await createEnrollToken(
        { roles: ["worker"], labels: { zone: "a" }, ttlMs: 600_000, by: "admin" },
        NOW,
      )
    ).unwrap();

  it("enrolls once per token, after the anchor committed the node, with a certificate pinning the CP key", async () => {
    const t = await token();
    const done = (await enroll(cfg(committed), request(t.token), NOW)).unwrap();
    expect(appended.at(-1)).toMatchObject({
      nodeId: done.nodeId,
      nodeEpoch: 1,
      identityKeyId: keyIdOf(publicKeyFromSeed(nodeSeed)),
    });
    const cert = verifyAndParse(
      done.certificate,
      [signer.publicKey],
      "otterd/enroll/v1",
      enrollCertificate,
    ).unwrap();
    expect(cert).toMatchObject({
      nodeId: done.nodeId,
      nodeEpoch: 1,
      identityKeyId: keyIdOf(publicKeyFromSeed(nodeSeed)),
      cpKeys: [{ key: signer.publicKey, epoch: 1 }],
      controlUrl: "wss://cp.test/api/otterd/connect",
    });
    expect(done.nodeId).toMatch(new RegExp(`^w1-${run}-[0-9a-f]{6}$`));
    const [row] = await db.select().from(otterdNode).where(eq(otterdNode.nodeId, done.nodeId));
    expect(row).toMatchObject({
      anchorSeq: appended.length,
      labels: { zone: "a" },
      admin: "active",
      fenceEnabled: false,
    });

    const again = await enroll(cfg(committed), request(t.token), NOW);
    expect(again.isErr() && again.error._tag === "OtterdRefusal" && again.error.reason).toBe(
      "token-invalid",
    );
  });

  it("refuses a request not signed by the key it presents", async () => {
    const t = await token();
    const forged = request(t.token, nodeSeed, new Uint8Array(32).fill(7));
    const r = await enroll(cfg(committed), forged, NOW);
    expect(r.isErr() && r.error._tag === "OtterdRefusal" && r.error.reason).toBe(
      "request-signature",
    );
  });

  it("refuses an expired token", async () => {
    const t = await token();
    const r = await enroll(cfg(committed), request(t.token), NOW + 3_600_001);
    expect(r.isErr() && r.error._tag === "OtterdRefusal" && r.error.reason).toBe("token-invalid");
  });

  it("issues nothing while the anchor is frozen", async () => {
    const t = await token();
    const frozen: RegistryConfig["anchor"] = async () =>
      Result.ok({ result: "pending-frozen", seq: 9, phase: "recovery-pending", term: 2 });
    const before = (await db.select().from(otterdNode)).length;
    const r = await enroll(cfg(frozen), request(t.token), NOW);
    expect(r.isErr() && r.error._tag === "OtterdRefusal" && r.error.reason).toBe("anchor-frozen");
    expect((await db.select().from(otterdNode)).length).toBe(before);
  });

  it("links the node to the server row its token was minted for, and resolves a pinned resource to it", async () => {
    const org = await seedOrganization("otterd-pin");
    const [srv] = await db
      .insert(server)
      .values({
        organizationId: org,
        name: `srv-${run}`,
        host: `10.0.0.${Math.floor(Math.random() * 200)}`,
        cpuTotal: 2,
        memTotalGb: 4,
      })
      .returning();
    if (!srv) throw new Error("server not seeded");
    const project = await seedProject(org);
    const svc = await seedService({
      projectId: project.projectId,
      environmentId: project.mainEnvironmentId,
      name: "pinned",
    });
    await db
      .update(resource)
      .set({ placementServerId: srv.id })
      .where(eq(resource.id, svc.resourceId));
    expect((await pinOf(svc.resourceId)).unwrap()).toEqual({
      pinned: true,
      nodeId: null,
      serverId: srv.id,
    });

    const t = (
      await createEnrollToken(
        { roles: ["worker"], labels: {}, ttlMs: 600_000, by: "admin", serverId: srv.id },
        NOW,
      )
    ).unwrap();
    const done = (
      await enroll(cfg(null), request(t.token, new Uint8Array(32).fill(14)), NOW)
    ).unwrap();
    expect((await pinOf(svc.resourceId)).unwrap()).toEqual({
      pinned: true,
      nodeId: done.nodeId,
      serverId: srv.id,
    });
    const other = await seedService({
      projectId: project.projectId,
      environmentId: project.mainEnvironmentId,
      name: "free",
    });
    expect((await pinOf(other.resourceId)).unwrap()).toEqual({ pinned: false });
  });

  it("resolves a resource pinned to the bootstrap localhost row to the primary node", async () => {
    const org = await seedOrganization("otterd-primary");
    const [local] = await db
      .insert(server)
      .values({
        organizationId: org,
        name: "localhost",
        host: "127.0.0.1",
        cpuTotal: 2,
        memTotalGb: 4,
      })
      .returning();
    if (!local) throw new Error("server not seeded");
    const project = await seedProject(org);
    const svc = await seedService({
      projectId: project.projectId,
      environmentId: project.mainEnvironmentId,
      name: "on-primary",
    });
    await db
      .update(resource)
      .set({ placementServerId: local.id })
      .where(eq(resource.id, svc.resourceId));
    const t = (
      await createEnrollToken(
        {
          roles: ["worker"],
          labels: { "otterdeploy.primary": "true" },
          ttlMs: 600_000,
          by: "installer",
        },
        NOW + 10,
      )
    ).unwrap();
    const done = (
      await enroll(cfg(null), request(t.token, new Uint8Array(32).fill(15)), NOW + 10)
    ).unwrap();
    expect((await pinOf(svc.resourceId)).unwrap()).toEqual({
      pinned: true,
      nodeId: done.nodeId,
      serverId: local.id,
    });
  });
});
