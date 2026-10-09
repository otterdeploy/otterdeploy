/**
 * removing a project network answers what happened, and only
 * ever removes a network this project created.
 */
import { DockerNotFoundError } from "@otterdeploy/docker";
import { Result } from "better-result";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const inspect = vi.fn();
const disconnect = vi.fn();
const remove = vi.fn();
const destroy = vi.fn();

vi.mock("@otterdeploy/docker", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@otterdeploy/docker")>()),
  Docker: {
    fromEnv: () => ({
      networks: { inspect, getNetwork: () => ({ disconnect, remove }) },
      destroy,
    }),
  },
}));

const { removeProjectNetwork } = await import("../client");

const target = { networkName: "otterdeploy-shop-staging", projectSlug: "shop" };

beforeEach(() => {
  for (const fn of [inspect, disconnect, remove, destroy]) fn.mockReset();
  disconnect.mockResolvedValue(Result.ok(undefined));
  remove.mockResolvedValue(Result.ok(undefined));
});

describe("removeProjectNetwork", () => {
  it("disconnects the edge and removes a network the project created", async () => {
    inspect.mockResolvedValue(
      Result.ok({
        Labels: { "otterdeploy.managed": "true", "otterdeploy.project": "shop" },
        Containers: { abc123: { Name: "otterdeploy-caddy" } },
      }),
    );
    const outcome = await removeProjectNetwork(target);
    expect(outcome.isOk() && outcome.value).toBe("removed");
    expect(disconnect).toHaveBeenCalledWith({ Container: "abc123", Force: true });
    expect(remove).toHaveBeenCalledOnce();
    expect(destroy).toHaveBeenCalledOnce();
  });

  it("leaves alone a same-named network another project created", async () => {
    inspect.mockResolvedValue(Result.ok({ Labels: { "otterdeploy.project": "shop-staging" } }));
    const outcome = await removeProjectNetwork(target);
    expect(outcome.isOk() && outcome.value).toBe("foreign");
    expect(remove).not.toHaveBeenCalled();
  });

  it("answers absent when there is no such network", async () => {
    inspect.mockResolvedValue(Result.err(new DockerNotFoundError({ message: "no such network" })));
    const outcome = await removeProjectNetwork(target);
    expect(outcome.isOk() && outcome.value).toBe("absent");
  });

  it("returns an unreachable daemon as an error to retry", async () => {
    inspect.mockResolvedValue(Result.err(new Error("connect ECONNREFUSED /var/run/docker.sock")));
    const outcome = await removeProjectNetwork(target);
    expect(outcome.isErr() && outcome.error.step).toBe("inspect-network");
    expect(remove).not.toHaveBeenCalled();
    expect(destroy).toHaveBeenCalledOnce();
  });

  it("returns the daemon's refusal as an error to retry, never as success", async () => {
    inspect.mockResolvedValue(Result.ok({ Labels: { "otterdeploy.project": "shop" } }));
    remove.mockResolvedValue(Result.err(new Error("network has active endpoints")));
    const outcome = await removeProjectNetwork(target);
    expect(outcome.isErr() && outcome.error.message).toBe(
      "swarm remove-network failed: network has active endpoints",
    );
    expect(destroy).toHaveBeenCalledOnce();
  });
});
