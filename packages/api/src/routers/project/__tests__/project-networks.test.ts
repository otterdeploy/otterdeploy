/**
 * deleting a project takes its overlay networks with it; one the
 * daemon will not remove yet is handed to the orphan GC, not forgotten.
 */
import { hasPrefix, type Id } from "@otterdeploy/shared/id";
import { Result } from "better-result";
import { createRequestLogger } from "evlog";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { SwarmOperationError } from "../../../swarm/errors";

const removeProjectNetwork = vi.fn();
const recordOrphanedResource = vi.fn();

vi.mock("../../../swarm", () => ({ removeProjectNetwork }));
vi.mock("../../../system-health/orphan-gc", () => ({ recordOrphanedResource }));

const { projectNetworkCandidates, removeProjectNetworks } = await import("../project-networks");

function testId<P extends string>(value: string, prefix: P): Id<P> {
  if (!hasPrefix(value, prefix)) throw new Error(`test id "${value}" lacks "${prefix}"`);
  return value;
}

const MAIN = testId("env_main", "env");
const STAGING = testId("env_staging", "env");
const owner = { organizationId: testId("org_1", "org"), projectId: testId("prj_1", "prj") };

beforeEach(() => {
  removeProjectNetwork.mockReset();
  recordOrphanedResource.mockReset();
});

describe("projectNetworkCandidates", () => {
  it("names the main network and one per additional environment", () => {
    expect(
      projectNetworkCandidates({
        slug: "shop",
        environments: [
          { id: MAIN, slug: "production" },
          { id: STAGING, slug: "staging" },
        ],
        mainEnvironmentId: MAIN,
      }),
    ).toEqual([
      { networkName: "otterdeploy-shop", projectSlug: "shop" },
      { networkName: "otterdeploy-shop-staging", projectSlug: "shop" },
    ]);
  });

  it("lists both spellings of a slug long enough to be capped for services", () => {
    const slug = "a-project-slug-that-runs-past-thirty-two";
    const names = projectNetworkCandidates({ slug, environments: [], mainEnvironmentId: null }).map(
      (c) => c.networkName,
    );
    expect(names).toEqual([`otterdeploy-${slug}`, `otterdeploy-${slug.slice(0, 32)}`]);
  });
});

describe("removeProjectNetworks", () => {
  it("removes each network and hands one the daemon refused to the orphan GC", async () => {
    removeProjectNetwork
      .mockResolvedValueOnce(Result.ok("removed"))
      .mockResolvedValueOnce(
        Result.err(
          new SwarmOperationError({
            step: "remove-network",
            cause: new Error("network has active endpoints"),
          }),
        ),
      )
      .mockResolvedValueOnce(Result.ok("absent"));
    const outcome = await removeProjectNetworks(
      [
        { networkName: "otterdeploy-shop", projectSlug: "shop" },
        { networkName: "otterdeploy-shop-staging", projectSlug: "shop" },
        { networkName: "otterdeploy-shop-qa", projectSlug: "shop" },
      ],
      owner,
      createRequestLogger({ method: "TEST", path: "/project/delete" }),
    );
    expect(outcome).toEqual({
      removed: ["otterdeploy-shop"],
      deferred: ["otterdeploy-shop-staging"],
    });
    expect(recordOrphanedResource).toHaveBeenCalledExactlyOnceWith({
      ...owner,
      resourceType: "network",
      ref: "otterdeploy-shop-staging",
      label:
        "project network otterdeploy-shop-staging: swarm remove-network failed: network has active endpoints",
      payload: { projectSlug: "shop" },
    });
  });
});
