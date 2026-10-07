/**
 * The API's terminal writes on a deployment row (markDeploymentRunning,
 * markDeploymentFailed) only move a row that is still in flight
 * (pending/building). A deployment an operator cancelled, or one another
 * writer already settled, keeps the outcome it has: a rollout or a stack
 * finalize that completes late does not bring it back as running, and a late
 * failure does not overwrite it.
 *
 * Real Postgres, real insert path (`insertDeployment`). The notification
 * fan-out is stood in for (it enqueues onto Redis): it records which events
 * were announced, since a refused write must not announce one.
 */
import type { DeploymentId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { deployment } from "@otterdeploy/db/schema/project";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { seedOrganization, seedProject, seedService } from "../../../__tests__/postgres-seed";
import { insertDeployment, markDeploymentFailed, markDeploymentRunning } from "../deployments";

const { announced } = vi.hoisted(() => ({ announced: new Array<string>() }));

vi.mock("../../../notifications/emit", () => ({
  emitPlatformEvent: async (input: { eventId: string }) => {
    announced.push(input.eventId);
  },
}));

beforeEach(() => {
  announced.length = 0;
});

async function seedDeployment(status: "pending" | "building"): Promise<DeploymentId> {
  const organizationId = await seedOrganization("deploy-writes");
  const { projectId, mainEnvironmentId } = await seedProject(organizationId);
  const service = await seedService({ projectId, environmentId: mainEnvironmentId, name: "web" });
  const row = await insertDeployment({
    resourceId: service.resourceId,
    image: "nginx:alpine",
    reason: "redeploy",
    status,
    snapshot: {},
  });
  return row.id;
}

/** What the operator's cancel leaves behind (routers/deployment/cancel.ts). */
async function cancel(id: DeploymentId): Promise<void> {
  // A Date only at the drizzle timestamp seam.
  await db
    .update(deployment)
    .set({ status: "cancelled", errorMessage: "Cancelled by test", completedAt: new Date() })
    .where(eq(deployment.id, id));
}

async function readDeployment(id: DeploymentId) {
  const [row] = await db
    .select({ status: deployment.status, errorMessage: deployment.errorMessage })
    .from(deployment)
    .where(eq(deployment.id, id));
  if (!row) throw new Error(`deployment ${id} vanished`);
  return row;
}

describe("deployment terminal writes", () => {
  it("settles an in-flight deployment as running", async () => {
    const id = await seedDeployment("building");
    expect(await markDeploymentRunning(id)).toBe(true);
    expect((await readDeployment(id)).status).toBe("running");
  });

  it("carries a partial outcome on a running stack deployment", async () => {
    const id = await seedDeployment("pending");
    expect(await markDeploymentRunning(id, "Some services failed: worker")).toBe(true);
    expect(await readDeployment(id)).toEqual({
      status: "running",
      errorMessage: "Some services failed: worker",
    });
  });

  it("a cancelled deployment is not brought back as running by a late rollout", async () => {
    const id = await seedDeployment("pending");
    await cancel(id);
    expect(await markDeploymentRunning(id)).toBe(false);
    expect(await readDeployment(id)).toEqual({
      status: "cancelled",
      errorMessage: "Cancelled by test",
    });
  });

  it("a cancelled deployment is not rewritten as failed", async () => {
    const id = await seedDeployment("building");
    await cancel(id);
    expect(await markDeploymentFailed(id, "late failure")).toBe(false);
    expect(await readDeployment(id)).toEqual({
      status: "cancelled",
      errorMessage: "Cancelled by test",
    });
    expect(announced).not.toContain("deploy.failed");
  });

  it("a settled deployment keeps its first outcome", async () => {
    const failed = await seedDeployment("building");
    expect(await markDeploymentFailed(failed, "build failed")).toBe(true);
    expect(announced.filter((id) => id === "deploy.failed")).toHaveLength(1);
    expect(await markDeploymentRunning(failed)).toBe(false);
    expect((await readDeployment(failed)).status).toBe("failed");

    const running = await seedDeployment("building");
    expect(await markDeploymentRunning(running)).toBe(true);
    expect(await markDeploymentFailed(running, "late failure")).toBe(false);
    expect(await readDeployment(running)).toEqual({ status: "running", errorMessage: null });
    expect(announced.filter((id) => id === "deploy.failed")).toHaveLength(1);
  });
});
