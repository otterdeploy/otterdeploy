import { describe, it, expect, vi, beforeEach } from "vitest";
import { setDockerClient, resetDockerClient } from "../client";
import { initSwarm, createIngressNetwork } from "../swarm";

describe("P0 Security: Port Hardening", () => {
  beforeEach(() => resetDockerClient());

  it("Swarm init binds to 127.0.0.1:2377 (localhost only)", async () => {
    const mock = {
      swarmInspect: vi.fn().mockRejectedValue(new Error("not in swarm")),
      swarmInit: vi.fn().mockResolvedValue("node-1"),
      listNetworks: vi.fn().mockResolvedValue([]),
      createNetwork: vi.fn().mockResolvedValue({ id: "net-1" }),
    } as any;
    setDockerClient(mock);

    await initSwarm();

    expect(mock.swarmInit).toHaveBeenCalledWith(
      expect.objectContaining({
        ListenAddr: "127.0.0.1:2377",
      }),
    );
    // Verify it's NOT 0.0.0.0
    const callArg = mock.swarmInit.mock.calls[0][0];
    expect(callArg.ListenAddr).not.toContain("0.0.0.0");
  });

  it("Ingress network is overlay type and attachable", async () => {
    const mock = {
      listNetworks: vi.fn().mockResolvedValue([]),
      createNetwork: vi.fn().mockResolvedValue({ id: "net-1" }),
    } as any;
    setDockerClient(mock);

    await createIngressNetwork();

    expect(mock.createNetwork).toHaveBeenCalledWith(
      expect.objectContaining({
        Driver: "overlay",
        Attachable: true,
      }),
    );
  });
});
