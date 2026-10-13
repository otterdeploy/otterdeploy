/**
 * The migration's durable side on a real Postgres: a held resource is the
 * migration's alone (the runtime refuses it, the scheduler does not see it),
 * an adopted grant is retired only by the node giving the very container
 * back, kept adopted containers are listed for deletion after a stop, and a
 * finalized migration sends every resource to otterd.
 */
import { db } from "@otterdeploy/db";
import {
  otterdAuthority,
  otterdEvidence,
  otterdGrant,
  otterdNode,
} from "@otterdeploy/db/schema/otterd";
import {
  normalizeServiceSpec,
  publicKeyFromSeed,
  serviceSpecInput,
} from "@otterdeploy/otterd-proto";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

import type { ContainerSpec, RuntimeDriver } from "../../runtime/types";

import { seedOrganization, seedProject, seedService } from "../../__tests__/postgres-seed";
import { ResourceMigratingError, ownerAware, runtimeOwnerOf } from "../../runtime/owner-router";
import { adoptedLeftBehind, markAdoptedRemoved, releaseAdoption } from "../migration/cp-store";
import {
  heldResourceIds,
  holdResource,
  migrationFinalized,
  openSession,
  setSessionState,
  stepResource,
} from "../migration/store";
import { admitGrant } from "../store/grants";
import { putService } from "../store/services";
import { loadSnapshot } from "../store/snapshot";

const NOW = 1_960_000_000_000;
const run = randomUUID().slice(0, 8);
const nodeId = `mig-${run}`;
let sessionId = "";

const spec = (resourceId: string) =>
  normalizeServiceSpec(
    serviceSpecInput.parse({
      resourceId,
      task: { container: { image: { reference: "nginx:1.27" } } },
    }),
  );

/** A base driver that must never be reached for a migrating resource. */
const reached = () => Promise.reject(new Error("the legacy driver was reached"));
const legacy: RuntimeDriver = {
  kind: "docker",
  provision: reached,
  update: reached,
  destroy: reached,
  inspect: reached,
  inspectMany: reached,
  provisionDatabase: reached,
  updateDatabase: reached,
  destroyDatabase: reached,
  inspectDatabase: reached,
  branchDatabase: reached,
  destroyDatabaseBranch: reached,
};

const containerSpec = (resourceId: string): ContainerSpec => ({
  resourceId,
  resourceName: "web",
  projectSlug: `p${run}`,
  serviceName: `od-mig-${run}`,
  internalHostname: "web",
  image: "nginx:1.27",
  env: {},
  replicas: 1,
  restart: { condition: "any", delayMs: 1_000 },
  ports: [],
  mounts: [],
  forceUpdateCounter: 1,
});

describe("otterd migration state", () => {
  beforeAll(async () => {
    const [existing] = await db.select().from(otterdAuthority).limit(1);
    if (!existing) {
      await db
        .insert(otterdAuthority)
        .values({ installId: `inst-${run}`, authorityTerm: 1, updatedAt: NOW });
    }
    await db.insert(otterdNode).values({
      nodeId,
      ordinal: 40_000_000 + Math.floor(Math.random() * 1e6),
      nodeEpoch: 1,
      keyEpoch: 1,
      identityKey: publicKeyFromSeed(new Uint8Array(32).fill(31)),
      identityKeyId: "4".repeat(32),
      roles: ["worker"],
      labels: {},
      arch: "x86_64",
      host: {},
      facts: {},
      allocatableNanoCpus: 2e9,
      allocatableMemoryBytes: 4 * 1024 ** 3,
      sessionId: `sess-${run}`,
      incarnation: `inc-${run}`,
      bootId: "boot",
      lastEvidenceAt: NOW,
      enrolledAt: NOW,
      updatedAt: NOW,
    });
    sessionId = (await openSession("test", NOW)).unwrap();
  });

  afterAll(async () => {
    await setSessionState(sessionId, "closed", NOW);
  });

  it("opens one session at a time", async () => {
    expect((await openSession("again", NOW)).unwrap()).toBe(sessionId);
  });

  it("a held resource is refused by the runtime and invisible to the scheduler until migrated", async () => {
    const org = await seedOrganization(`mig-${run}`);
    const project = await seedProject(org);
    const svc = await seedService({
      projectId: project.projectId,
      environmentId: project.mainEnvironmentId,
      name: "web",
    });
    const id = svc.resourceId;
    const fields = {
      nodeId,
      serviceName: `od-mig-${run}`,
      containerId: "c".repeat(64),
      beforeImage: null,
    };
    (await holdResource(sessionId, id, fields, NOW)).unwrap();
    expect(await runtimeOwnerOf(id)).toBe("migrating");
    const router = ownerAware(legacy);
    await expect(router.provision(containerSpec(id))).rejects.toBeInstanceOf(
      ResourceMigratingError,
    );
    // A second hold is refused: the resource is no longer the legacy runtime's.
    expect((await holdResource(sessionId, id, fields, NOW)).isErr()).toBe(true);

    (await putService(spec(id), NOW, fields.serviceName)).unwrap();
    expect((await heldResourceIds()).has(id)).toBe(true);
    const held = (await loadSnapshot(NOW)).unwrap();
    expect(held.services.some((s) => s.resourceId === id)).toBe(false);

    const g = (
      await admitGrant({
        resourceId: id,
        slotIndex: 0,
        nodeId,
        exclusive: false,
        surge: false,
        specRevision: 1,
        reason: "migration",
        now: NOW,
        adoptsContainer: fields.containerId,
      })
    ).unwrap();
    expect(g.adoptsContainer).toBe(fields.containerId);
    expect((await loadSnapshot(NOW)).unwrap().grants.some((x) => x.grantId === g.grantId)).toBe(
      false,
    );

    (await stepResource(id, "migrated", NOW, { grantId: g.grantId, owner: "otterd" })).unwrap();
    expect(await runtimeOwnerOf(id)).toBe("otterd");
    const free = (await loadSnapshot(NOW)).unwrap();
    expect(free.services.some((s) => s.resourceId === id)).toBe(true);
    expect(free.grants.some((x) => x.grantId === g.grantId)).toBe(true);

    // Given back: only the node's answer naming that very container retires the grant.
    expect((await releaseAdoption(g.grantId, "d".repeat(64), NOW)).isErr()).toBe(true);
    (await releaseAdoption(g.grantId, fields.containerId, NOW)).unwrap();
    const [row] = await db.select().from(otterdGrant).where(eq(otterdGrant.grantId, g.grantId));
    expect(row).toMatchObject({
      state: "released",
      releaseEvidenceId: `adoption-released:${fields.containerId}`,
    });
    const left = (await adoptedLeftBehind()).unwrap();
    expect(left.some((x) => x.grantId === g.grantId)).toBe(false);
  });

  it("lists an adopted container a stop kept, until it is deleted", async () => {
    const id = `res_kept${run}`;
    (await putService(spec(id), NOW)).unwrap();
    const g = (
      await admitGrant({
        resourceId: id,
        slotIndex: 0,
        nodeId,
        exclusive: false,
        surge: false,
        specRevision: 1,
        reason: "migration",
        now: NOW,
        adoptsContainer: "e".repeat(64),
      })
    ).unwrap();
    // Refused, never adopted: nothing to delete.
    await db
      .update(otterdGrant)
      .set({ state: "released", releaseEvidenceId: `refused_${g.grantId}` })
      .where(eq(otterdGrant.grantId, g.grantId));
    expect((await adoptedLeftBehind()).unwrap().some((x) => x.grantId === g.grantId)).toBe(false);
    // Stopped with a certificate: the kept container is the control plane's to delete.
    await db.insert(otterdEvidence).values({
      evidenceId: `cert_${g.grantId}`,
      kind: "stop-certificate",
      nodeId,
      nodeEpoch: 1,
      grantId: g.grantId,
      document: {},
      observedAt: NOW,
      recordedAt: NOW,
    });
    await db
      .update(otterdGrant)
      .set({ releaseEvidenceId: `cert_${g.grantId}` })
      .where(eq(otterdGrant.grantId, g.grantId));
    expect((await adoptedLeftBehind()).unwrap().some((x) => x.grantId === g.grantId)).toBe(true);
    (await markAdoptedRemoved(g.grantId, NOW)).unwrap();
    expect((await adoptedLeftBehind()).unwrap().some((x) => x.grantId === g.grantId)).toBe(false);
  });

  it("once finalized, every resource goes to otterd and Swarm is no longer initialized", async () => {
    const org = await seedOrganization(`mig2-${run}`);
    const project = await seedProject(org);
    const svc = await seedService({
      projectId: project.projectId,
      environmentId: project.mainEnvironmentId,
      name: "late",
    });
    expect(await runtimeOwnerOf(svc.resourceId)).toBe("legacy");
    (await setSessionState(sessionId, "finalized", NOW)).unwrap();
    expect(await migrationFinalized()).toBe(true);
    expect(await runtimeOwnerOf(svc.resourceId)).toBe("otterd");
    (await setSessionState(sessionId, "closed", NOW)).unwrap();
    expect(await runtimeOwnerOf(svc.resourceId)).toBe("legacy");
  });
});
