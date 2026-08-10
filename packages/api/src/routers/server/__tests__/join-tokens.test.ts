import { describe, expect, test, vi } from "vite-plus/test";

const destroy = vi.fn();
const swarmInspect = vi.fn();
const info = vi.fn();

vi.mock("@otterdeploy/docker", () => ({
  Docker: {
    fromEnv: () => ({
      system: { swarmInspect, info },
      destroy,
    }),
  },
}));

const { getSwarmJoinTokens } = await import("../join-tokens");

describe("getSwarmJoinTokens", () => {
  test("returns daemon values and always releases the Docker client", async () => {
    swarmInspect.mockResolvedValueOnce({
      isErr: () => false,
      value: { JoinTokens: { Worker: "worker-secret", Manager: "manager-secret" } },
    });
    info.mockResolvedValueOnce({
      isOk: () => true,
      value: { Swarm: { NodeAddr: "10.0.0.4" } },
    });

    await expect(getSwarmJoinTokens()).resolves.toEqual({
      worker: "worker-secret",
      manager: "manager-secret",
      managerAddr: "10.0.0.4:2377",
    });
    expect(destroy).toHaveBeenCalledOnce();
  });

  test("releases the Docker client on the degraded early-return path", async () => {
    destroy.mockClear();
    info.mockClear();
    swarmInspect.mockResolvedValueOnce({ isErr: () => true });

    await expect(getSwarmJoinTokens()).resolves.toEqual({
      worker: "–",
      manager: "–",
      managerAddr: "–",
    });
    expect(info).not.toHaveBeenCalled();
    expect(destroy).toHaveBeenCalledOnce();
  });
});
