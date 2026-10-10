/**
 * Against a migrated Postgres: a health-gated rollout runs off the request.
 *
 * `service.update` / `service.create` / `service.restart` used to await the
 * rollout inside the request. A rollout that needed longer than the 120 s
 * procedure deadline (an image still pulling from an unreachable registry, a
 * port nothing listens on) answered TIMEOUT, stored no deployment and no
 * reason, and left the service "starting". Here the runtime's rollout is a promise the test holds open, as
 * long as it likes: the write must answer with a `pending` deployment while it
 * is still open, and the `service.rollout` job body must then record the
 * outcome on that row, success or the failure's reason.
 *
 * Without the fix the handler awaits the held rollout and never answers: every
 * `answered` race below loses to the held rollout and the test fails.
 */
import type { ServiceRolloutPayload } from "@otterdeploy/jobs";
import type { DeploymentId, ResourceId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { deployment } from "@otterdeploy/db/schema/project";
import { eq } from "drizzle-orm";
import { createRequestLogger } from "evlog";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type { RuntimeDriver } from "../../../runtime";
import type { SwarmServiceRuntime } from "../../../swarm";

vi.mock("../../../runtime", () => ({ runtime: vi.fn(), isSwarmRuntime: () => false }));

const { runtime } = await import("../../../runtime");
const { createService, restartService, updateService } = await import("../handlers");
const { rolloutDispatch, runServiceRollout } = await import("../rollout");
const { seedOrganization, seedProject, seedService } =
  await import("../../../__tests__/postgres-seed");

const log = createRequestLogger({ method: "TEST", path: "/service/rollout-off-request" });

/** A rollout the test settles when it chooses: as slow as it needs to be. */
interface HeldRollout {
  started: Promise<void>;
  settle: (outcome: SwarmServiceRuntime) => void;
}

let held: HeldRollout;
let queued: ServiceRolloutPayload[];

function holdRollout(): HeldRollout {
  let markStarted = (): void => undefined;
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  let settle: (outcome: SwarmServiceRuntime) => void = () => undefined;
  const gate = new Promise<SwarmServiceRuntime>((resolve) => {
    settle = resolve;
  });
  const roll = async (): Promise<SwarmServiceRuntime> => {
    markStarted();
    return gate;
  };
  const live = async (): Promise<SwarmServiceRuntime> => ({
    serviceId: "c-old",
    serviceName: "svc",
    networkName: "net",
    status: "running",
    health: null,
  });
  const unexpected = (): never => {
    throw new Error("unexpected runtime call in rollout-off-request.postgres.test");
  };
  const driver: RuntimeDriver = {
    kind: "docker",
    provision: roll,
    update: roll,
    destroy: unexpected,
    inspect: live,
    inspectMany: async () => new Map(),
    provisionDatabase: unexpected,
    updateDatabase: unexpected,
    destroyDatabase: unexpected,
    inspectDatabase: unexpected,
    branchDatabase: unexpected,
    destroyDatabaseBranch: unexpected,
  };
  vi.mocked(runtime).mockReturnValue(driver);
  return { started, settle };
}

const RUNNING: SwarmServiceRuntime = {
  serviceId: "c-new",
  serviceName: "svc",
  networkName: "net",
  status: "running",
  health: null,
};

const ROLLED_BACK: SwarmServiceRuntime = {
  serviceId: "c-old",
  serviceName: "svc",
  networkName: "net",
  status: "error",
  health: null,
  errorMessage:
    "new version never became ready within 120s: its image registry.example/web:2 was still pulling; the previous version keeps serving",
  rolledBack: true,
};

/** Did `work` answer before the held rollout was released? */
async function answersWhileHeld<T>(work: Promise<T>): Promise<T> {
  const timedOut = Symbol("held");
  const winner = await Promise.race([
    work,
    new Promise<typeof timedOut>((resolve) => {
      setTimeout(() => resolve(timedOut), 5_000);
    }),
  ]);
  if (winner === timedOut) throw new Error("the write waited for the rollout to finish");
  return winner;
}

async function row(id: DeploymentId) {
  const [found] = await db.select().from(deployment).where(eq(deployment.id, id));
  if (!found) throw new Error(`deployment ${id} not found`);
  return found;
}

/** Run the job the write enqueued, the way the server's worker does. */
function runQueuedJob(): Promise<void> {
  const [payload] = queued;
  if (!payload) throw new Error("the write enqueued no rollout");
  return runServiceRollout(payload);
}

let ref: {
  organizationId: Awaited<ReturnType<typeof seedOrganization>>;
  projectId: Awaited<ReturnType<typeof seedProject>>["projectId"];
  resourceId: ResourceId;
};
let environmentId: Awaited<ReturnType<typeof seedProject>>["mainEnvironmentId"];

beforeAll(async () => {
  const organizationId = await seedOrganization("rollout-off-request");
  const project = await seedProject(organizationId);
  environmentId = project.mainEnvironmentId;
  const { resourceId } = await seedService({
    projectId: project.projectId,
    environmentId,
    name: "web",
  });
  ref = { organizationId, projectId: project.projectId, resourceId };
});

beforeEach(() => {
  queued = [];
  rolloutDispatch.enqueue = async (payload) => {
    queued.push(payload);
    return undefined;
  };
  held = holdRollout();
});

describe("rollouts run off the request", () => {
  it("an update answers with a pending deployment while a slow rollout runs; the job records success", async () => {
    const updated = await answersWhileHeld(
      updateService({ ...ref, image: "registry.example/web:2" }, log),
    );
    if (updated.isErr()) throw updated.error;
    const deploymentId = updated.value.deploymentId;
    if (deploymentId === null) throw new Error("the update recorded no deployment");
    expect((await row(deploymentId)).status).toBe("pending");
    expect((await row(deploymentId)).reason).toBe("image-change");
    expect(queued[0]?.deploymentIds).toEqual([deploymentId]);

    const job = runQueuedJob();
    await held.started;
    expect((await row(deploymentId)).status).toBe("pending");
    held.settle(RUNNING);
    await job;

    const settled = await row(deploymentId);
    expect(settled.status).toBe("running");
    expect(settled.errorMessage).toBeNull();
  });

  it("a rollout that fails and is rolled back records why on its deployment", async () => {
    const restarted = await answersWhileHeld(restartService(ref, log));
    if (restarted.isErr()) throw restarted.error;
    const deploymentId = restarted.value.deploymentId;
    if (deploymentId === null) throw new Error("the restart recorded no deployment");
    expect((await row(deploymentId)).reason).toBe("restart");

    const job = runQueuedJob();
    await held.started;
    held.settle(ROLLED_BACK);
    await job;

    const settled = await row(deploymentId);
    expect(settled.status).toBe("failed");
    expect(settled.errorMessage).toContain("was still pulling");
    expect(settled.errorMessage).toContain("the previous version keeps serving");
  });

  it("an image create answers `starting` with its deployment; a rollout that never gets ready fails it with the reason", async () => {
    const created = await answersWhileHeld(
      createService(
        {
          projectId: ref.projectId,
          organizationId: ref.organizationId,
          environmentId,
          name: `stress-${crypto.randomUUID().slice(0, 8)}`,
          image: "registry.example/stress:1",
          ports: [{ containerPort: 8080, appProtocol: "http", isPrimary: true }],
        },
        log,
      ),
    );
    if (created.isErr()) throw created.error;
    expect(created.value.runtime.status).toBe("starting");
    const deploymentId = created.value.deploymentId;
    if (deploymentId === null) throw new Error("the create recorded no deployment");
    expect(queued[0]?.kind).toBe("create");

    const job = runQueuedJob();
    await held.started;
    held.settle({
      serviceId: "c-new",
      serviceName: "svc",
      networkName: "net",
      status: "error",
      health: null,
      errorMessage: "new version never answered on port 8080 within 120s; nothing listens on 8080",
    });
    await job;

    const settled = await row(deploymentId);
    expect(settled.status).toBe("failed");
    expect(settled.errorMessage).toContain("nothing listens on 8080");
  });

  it("with the job queue unreachable the rollout still runs, in-process, and records its outcome", async () => {
    rolloutDispatch.enqueue = async () => {
      throw new Error("job queue service.rollout is unavailable (is Redis reachable?)");
    };
    const updated = await answersWhileHeld(updateService({ ...ref, replicas: 1 }, log));
    if (updated.isErr()) throw updated.error;
    const deploymentId = updated.value.deploymentId;
    if (deploymentId === null) throw new Error("the update recorded no deployment");
    await held.started;
    held.settle(RUNNING);
    await vi.waitFor(async () => expect((await row(deploymentId)).status).toBe("running"));
  });
});
