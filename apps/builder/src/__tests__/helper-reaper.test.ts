/**
 * Build helpers left behind by a builder that died mid-build. The docker
 * CLI is a fake recording every call; what is asserted is which containers
 * the builder would adopt, remove or leave.
 */
import type { DeploymentId } from "@otterdeploy/shared/id";

import { idSchema } from "@otterdeploy/shared/id";
import { describe, expect, test } from "bun:test";

import { helperContainerName } from "../helper-args";
import {
  createDockerCli,
  DOCKER_CLI_TIMEOUT_MS,
  type DockerCli,
  helperState,
  listHelperDeployments,
  reapOrphanHelpers,
  removeStaleHelper,
} from "../helper-reaper";

const BUILDING = idSchema.deployment.parse("dep_building00000000000000");
const FAILED = idSchema.deployment.parse("dep_failed0000000000000000");
const GONE = idSchema.deployment.parse("dep_gone000000000000000000");
const UNREADABLE = idSchema.deployment.parse("dep_unreadable000000000000");

/** A daemon holding these helper containers (name -> state). */
function fakeDaemon(containers: Map<string, string>) {
  const calls: string[][] = [];
  const docker: DockerCli = async (args) => {
    calls.push(args);
    const [verb] = args;
    const name = args.at(-1) ?? "";
    if (verb === "ps")
      return { code: 0, stdout: `${[...containers.keys(), "postgres"].join("\n")}\n` };
    if (verb === "inspect") {
      const state = containers.get(name);
      return state ? { code: 0, stdout: `${state}\n` } : { code: 1, stdout: "" };
    }
    if (verb === "rm") {
      const existed = containers.delete(name);
      return existed ? { code: 0, stdout: `${name}\n` } : { code: 1, stdout: "" };
    }
    return { code: 1, stdout: "" };
  };
  return { docker, calls };
}

describe("a helper the job's own deployment left behind", () => {
  test("a running one is reported running (the job adopts it)", async () => {
    const { docker } = fakeDaemon(new Map([[helperContainerName(BUILDING), "running"]]));
    expect(await helperState(BUILDING, docker)).toBe("running");
  });

  test("one that exists but no longer runs is stale, and removing it frees the name", async () => {
    const daemon = new Map([[helperContainerName(FAILED), "exited"]]);
    const { docker } = fakeDaemon(daemon);
    expect(await helperState(FAILED, docker)).toBe("stale");
    expect(await removeStaleHelper(FAILED, docker)).toBe(true);
    expect(await helperState(FAILED, docker)).toBe("absent");
  });

  test("no helper at all is absent, and removing nothing reports nothing removed", async () => {
    const { docker } = fakeDaemon(new Map());
    expect(await helperState(GONE, docker)).toBe("absent");
    expect(await removeStaleHelper(GONE, docker)).toBe(false);
  });
});

describe("the orphan sweep", () => {
  test("lists only helper containers whose suffix is a deployment id", async () => {
    const { docker } = fakeDaemon(
      new Map([
        [helperContainerName(BUILDING), "running"],
        ["otterbuild-not-an-id", "running"],
      ]),
    );
    expect(await listHelperDeployments(docker)).toEqual([BUILDING]);
  });

  test("removes helpers of terminal or deleted deployments, keeps in-flight and unreadable ones", async () => {
    const daemon = new Map([
      [helperContainerName(BUILDING), "running"],
      [helperContainerName(FAILED), "running"],
      [helperContainerName(GONE), "running"],
      [helperContainerName(UNREADABLE), "running"],
    ]);
    const { docker } = fakeDaemon(daemon);
    const statuses = new Map<DeploymentId, string | null>([
      [BUILDING, "building"],
      [FAILED, "failed"],
      [GONE, null],
    ]);
    const reaped = await reapOrphanHelpers({
      docker,
      status: async (id) => {
        if (id === UNREADABLE) throw new Error("database unreachable");
        return statuses.get(id) ?? null;
      },
    });
    expect(reaped.sort()).toEqual([FAILED, GONE].sort());
    expect([...daemon.keys()].sort()).toEqual(
      [helperContainerName(BUILDING), helperContainerName(UNREADABLE)].sort(),
    );
  });
});

describe("the docker CLI the sweep runs", () => {
  test("a call that never answers is killed at the bound and reads as a failure", async () => {
    // `sleep` stands in for a wedged daemon: it holds the call open.
    const wedged = createDockerCli("sleep", 50);
    const started = performance.now();
    expect(await wedged(["30"])).toEqual({ code: -1, stdout: "" });
    expect(performance.now() - started).toBeLessThan(5_000);
    expect(DOCKER_CLI_TIMEOUT_MS).toBeGreaterThan(0);
  });

  test("a CLI that is not there reads as a failure, never a throw", async () => {
    const missing = createDockerCli("/nonexistent/docker-cli-for-test");
    expect((await missing(["ps"])).code).toBe(-1);
  });
});
