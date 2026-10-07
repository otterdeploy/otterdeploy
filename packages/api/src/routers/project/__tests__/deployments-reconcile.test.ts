/**
 * The list read's success detector must not settle a row a deploy job still
 * owns: the builder is mid-rollout and owns the verdict, and a version the
 * readiness gate rolls back must end `failed`, never `running`.
 */
import { idSchema } from "@otterdeploy/shared/id";
import { beforeEach, describe, expect, test, vi } from "vite-plus/test";

// Every guarded UPDATE reports that it flipped its row, so each id that
// reaches it emits deploy.succeeded: the emits are the ids that were settled.
const updateChain = { set: vi.fn(), where: vi.fn(), returning: vi.fn() };
updateChain.set.mockReturnValue(updateChain);
updateChain.where.mockReturnValue(updateChain);
updateChain.returning.mockResolvedValue([{ id: "flipped" }]);

vi.mock("@otterdeploy/db", () => ({
  db: { update: vi.fn(() => updateChain) },
}));

vi.mock("@otterdeploy/jobs", () => ({
  inFlightDeploys: vi.fn(),
}));

vi.mock("../deployments", () => ({ markDeploymentFailed: vi.fn() }));
vi.mock("../deployments-emit", () => ({ emitDeploySucceeded: vi.fn() }));
vi.mock("../project-event-bus", () => ({ publishResourceChanged: vi.fn() }));

import { inFlightDeploys } from "@otterdeploy/jobs";

import { emitDeploySucceeded } from "../deployments-emit";
import { reconcileObservedSuccess } from "../deployments-reconcile";

const resourceId = idSchema.resource.parse("res_web");
const owned = idSchema.deployment.parse("dep_rolling");
const orphan = idSchema.deployment.parse("dep_orphaned");

function settled(): string[] {
  return vi.mocked(emitDeploySucceeded).mock.calls.map(([args]) => args.deploymentId);
}

beforeEach(() => {
  vi.mocked(emitDeploySucceeded).mockClear();
  vi.mocked(inFlightDeploys).mockReset();
});

describe("reconcileObservedSuccess", () => {
  test("leaves a row a deploy job still owns to the builder", async () => {
    vi.mocked(inFlightDeploys).mockResolvedValue({ ownedIds: new Set([owned]), anyActive: true });
    await reconcileObservedSuccess([owned, orphan], resourceId);
    expect(settled()).toEqual([orphan]);
    expect(emitDeploySucceeded).toHaveBeenCalledWith({ deploymentId: orphan, resourceId });
  });

  test("settles the row once no job owns it", async () => {
    vi.mocked(inFlightDeploys).mockResolvedValue({ ownedIds: new Set(), anyActive: false });
    await reconcileObservedSuccess([owned], resourceId);
    expect(settled()).toEqual([owned]);
  });

  test("a failed job scan falls back to settling, as before", async () => {
    vi.mocked(inFlightDeploys).mockRejectedValue(new Error("redis down"));
    await reconcileObservedSuccess([owned], resourceId);
    expect(settled()).toEqual([owned]);
  });

  test("nothing to settle reads no queue", async () => {
    await reconcileObservedSuccess([], resourceId);
    expect(inFlightDeploys).not.toHaveBeenCalled();
    expect(settled()).toEqual([]);
  });
});
