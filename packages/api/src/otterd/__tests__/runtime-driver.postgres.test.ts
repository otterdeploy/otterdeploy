/**
 * The otterd runtime driver's store side on a real Postgres: a deploy writes
 * the desired service under its runtime name and claims the resource for
 * otterd; status is read from the scheduler's grants, never from Docker.
 */
import { db } from "@otterdeploy/db";
import { otterdAuthority, otterdNode } from "@otterdeploy/db/schema/otterd";
import { publicKeyFromSeed } from "@otterdeploy/otterd-proto";
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vite-plus/test";

import type { ContainerSpec } from "../../runtime/types";

import { placementOf } from "../../runtime/otterd-driver";
import { admitGrant, markSent } from "../store/grants";
import { applySlotReports } from "../store/reports";
import { putService, setPaused } from "../store/services";
import { claimForOtterd, failureText, statusByName } from "../store/status";
import { serviceToSpec } from "../translate";

const NOW = 1_930_000_000_000;
const run = randomUUID().slice(0, 8);
const nodeId = `drv-${run}`;

const spec = (resourceId: string, serviceName: string): ContainerSpec => ({
  resourceId,
  resourceName: "web",
  projectSlug: `p${run}`,
  serviceName,
  internalHostname: "web",
  image: "python:3.12-alpine",
  env: {},
  replicas: 1,
  restart: { condition: "any", delayMs: 1_000 },
  ports: [],
  mounts: [],
  forceUpdateCounter: 1,
});

describe("otterd runtime driver state", () => {
  beforeAll(async () => {
    const [existing] = await db.select().from(otterdAuthority).limit(1);
    if (!existing)
      await db
        .insert(otterdAuthority)
        .values({ installId: `inst-${run}`, authorityTerm: 1, updatedAt: NOW });
    await db.insert(otterdNode).values({
      nodeId,
      ordinal: 12_000_000 + Math.floor(Math.random() * 1e6),
      nodeEpoch: 1,
      keyEpoch: 1,
      identityKey: publicKeyFromSeed(new Uint8Array(32).fill(21)),
      identityKeyId: "2".repeat(32),
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

  it("reports missing, then starting, then running from the grants of the target revision", async () => {
    const id = `res_drv${run}`;
    const name = `od-p${run}-web`;
    expect((await statusByName([name])).unwrap().get(name)?.status).toBe("missing");
    expect((await claimForOtterd(id)).unwrap()).toBe(true);
    const s = serviceToSpec(spec(id, name), { nodeId: null }).unwrap();
    expect((await putService(s, NOW, name)).unwrap()).toBe(1);
    expect((await statusByName([name])).unwrap().get(name)).toMatchObject({
      status: "starting",
      resourceId: id,
      revision: 1,
    });

    const g = (
      await admitGrant({
        resourceId: id,
        slotIndex: 0,
        nodeId,
        exclusive: false,
        surge: false,
        specRevision: 1,
        reason: "t",
        now: NOW,
      })
    ).unwrap();
    (await markSent(g.grantId, NOW)).unwrap();
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
          process: { state: "unknown" as const, reason: "not observed in this report" },
          mutations: [{ mutationId: "mut_1", verb: "start" as const, state: "settled" as const }],
        },
      ],
    };
    (await applySlotReports(nodeId, `sess-${run}`, [report], NOW + 1)).unwrap();
    expect((await statusByName([name])).unwrap().get(name)).toMatchObject({
      status: "running",
      running: 1,
    });

    // A frozen process holds the slot but does not serve.
    const frozen = {
      ...report,
      attempts: [
        {
          ...report.attempts[0],
          attemptId: "att_1",
          ordinal: 1,
          process: { state: "paused" as const, pid: 7 },
          mutations: [{ mutationId: "mut_1", verb: "start" as const, state: "settled" as const }],
        },
      ],
    };
    (await applySlotReports(nodeId, `sess-${run}`, [frozen], NOW + 2)).unwrap();
    expect((await statusByName([name])).unwrap().get(name)).toMatchObject({
      status: "starting",
      running: 0,
    });

    // The node could not run the attempt (here: the image did not pull). The
    // grant still says running; the attempt's failure is what fails it, and
    // the deploy status says why.
    const unpulled = {
      ...report,
      attempts: [
        {
          attemptId: "att_1",
          ordinal: 1,
          process: { state: "absent" as const },
          failure: { code: "image-pull-failed", message: "pull access denied for python" },
          mutations: [{ mutationId: "mut_c", verb: "create" as const, state: "retired" as const }],
        },
      ],
    };
    (await applySlotReports(nodeId, `sess-${run}`, [unpulled], NOW + 3)).unwrap();
    const failed = (await statusByName([name])).unwrap().get(name);
    expect(failed).toMatchObject({
      status: "error",
      failure: { code: "image-pull-failed", message: "pull access denied for python" },
    });
    expect(failed?.failure && failureText(failed.failure)).toBe(
      "image pull failed: pull access denied for python",
    );

    (await setPaused(id, true, NOW + 2)).unwrap();
    expect((await statusByName([name])).unwrap().get(name)?.desiredPaused).toBe(true);
  });

  it("keeps a registry-less build on the build host, and refuses a pin elsewhere", async () => {
    const primary = `primary-${run}`;
    await db.insert(otterdNode).values({
      nodeId: primary,
      ordinal: 13_000_000 + Math.floor(Math.random() * 1e6),
      nodeEpoch: 1,
      keyEpoch: 1,
      identityKey: publicKeyFromSeed(new Uint8Array(32).fill(22)),
      identityKeyId: "3".repeat(32),
      roles: ["worker"],
      labels: { "otterdeploy.primary": "true" },
      arch: "x86_64",
      host: {},
      facts: {},
      allocatableNanoCpus: 2e9,
      allocatableMemoryBytes: 4 * 1024 ** 3,
      enrolledAt: NOW + 1_000_000,
      updatedAt: NOW,
    });
    // Not a resource row: unpinned.
    expect(await placementOf(`res_loc${run}`, "otterdeploy-local/web:abc")).toEqual({
      nodeId: primary,
    });
    expect(await placementOf(`res_loc${run}`, "ghcr.io/acme/web:abc")).toEqual({ nodeId: null });
  });
});
