/**
 * A service otterd runs lists its grants as the resource's instances, with
 * the container the node reported, so the instances and log views work
 * whatever the install's runtime.
 */
import { db } from "@otterdeploy/db";
import { otterdAuthority, otterdNode } from "@otterdeploy/db/schema/otterd";
import {
  normalizeServiceSpec,
  publicKeyFromSeed,
  serviceSpecInput,
} from "@otterdeploy/otterd-proto";
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vite-plus/test";

import { otterdInstances } from "../../routers/project/otterd-instances";
import { admitGrant, markSent } from "../store/grants";
import { applySlotReports } from "../store/reports";
import { putService } from "../store/services";

const NOW = 1_970_000_000_000;
const run = randomUUID().slice(0, 8);
const nodeId = `inst-${run}`;

describe("otterd service instances", () => {
  beforeAll(async () => {
    const [existing] = await db.select().from(otterdAuthority).limit(1);
    if (!existing) {
      await db
        .insert(otterdAuthority)
        .values({ installId: `inst-${run}`, authorityTerm: 1, updatedAt: NOW });
    }
    await db.insert(otterdNode).values({
      nodeId,
      ordinal: 50_000_000 + Math.floor(Math.random() * 1e6),
      nodeEpoch: 1,
      keyEpoch: 1,
      identityKey: publicKeyFromSeed(new Uint8Array(32).fill(41)),
      identityKeyId: "5".repeat(32),
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
  });

  it("lists each grant with its slot, node, state, deployment and container", async () => {
    const id = `res_inst${run}`;
    const name = `od-inst-${run}`;
    expect(await otterdInstances(name)).toBeNull();
    const spec = normalizeServiceSpec(
      serviceSpecInput.parse({
        resourceId: id,
        task: {
          container: {
            image: { reference: "nginx:1.27" },
            labels: { "otterdeploy.deployment.id": "dep_7" },
          },
        },
      }),
    );
    (await putService(spec, NOW, name)).unwrap();
    const g = (
      await admitGrant({
        resourceId: id,
        slotIndex: 0,
        nodeId,
        exclusive: false,
        surge: false,
        specRevision: 1,
        reason: "test",
        now: NOW,
      })
    ).unwrap();
    (await markSent(g.grantId, NOW)).unwrap();
    expect((await otterdInstances(name))?.[0]).toMatchObject({ state: "starting", slot: 0 });
    const report = {
      slot: { resourceId: id, index: 0 },
      grantId: g.grantId,
      generation: 1,
      state: "running" as const,
      quarantined: false,
      revoked: false,
      attempts: [
        {
          attemptId: "att_1",
          ordinal: 1,
          container: "f".repeat(64),
          process: { state: "running" as const, pid: 7 },
          mutations: [],
        },
      ],
    };
    (await applySlotReports(nodeId, `sess-${run}`, [report], NOW + 1)).unwrap();
    expect(await otterdInstances(name)).toEqual([
      expect.objectContaining({
        id: g.grantId,
        containerId: "f".repeat(64),
        state: "running",
        slot: 0,
        nodeId,
        desiredState: "running",
        deploymentId: "dep_7",
        restartCount: 0,
      }),
    ]);
  });
});
