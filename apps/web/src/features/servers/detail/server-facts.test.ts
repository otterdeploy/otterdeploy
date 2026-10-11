import { describe, expect, it } from "vite-plus/test";

import { serverAddressView, serverDisplayName, workloadCount } from "./server-facts";

const cp = {
  name: "localhost",
  hostname: "cp-fra-1",
  host: "127.0.0.1",
  role: "manager" as const,
  labels: ["bootstrap"],
};
const worker = {
  name: "w1",
  hostname: "w1-host",
  host: "10.0.0.5",
  role: "worker" as const,
  labels: [],
};

describe("serverDisplayName", () => {
  it("names the control plane by the machine's hostname, not the bootstrap row's 'localhost'", () => {
    expect(serverDisplayName(cp)).toBe("cp-fra-1");
  });

  it("keeps the registered name when the host has not reported one", () => {
    expect(serverDisplayName({ ...cp, hostname: null })).toBe("localhost");
  });

  it("keeps an operator's own name for any other server", () => {
    expect(serverDisplayName(worker)).toBe("w1");
  });
});

describe("serverAddressView", () => {
  it("shows the address the server list resolved (the public IP for the control plane)", () => {
    expect(serverAddressView({ ...cp, address: "203.0.113.7" })).toEqual({
      kind: "known",
      address: "203.0.113.7",
    });
  });

  it("never shows loopback as a machine's address", () => {
    expect(serverAddressView({ ...cp, address: null })).toEqual({ kind: "unknown" });
    expect(serverAddressView(cp)).toEqual({ kind: "unknown" });
  });

  it("says the control plane has an address this viewer was not sent", () => {
    expect(serverAddressView({ ...cp, address: null, addressHidden: true })).toEqual({
      kind: "hidden",
    });
  });

  it("falls back to the registered host for other servers", () => {
    expect(serverAddressView(worker)).toEqual({ kind: "known", address: "10.0.0.5" });
  });
});

describe("workloadCount", () => {
  it("counts swarm tasks on Swarm", () => {
    expect(workloadCount(5, true)).toBe("5 tasks");
    expect(workloadCount(1, true)).toBe("1 task");
  });

  it("counts containers on plain Docker, where there are no tasks", () => {
    expect(workloadCount(5, false)).toBe("5 containers");
    expect(workloadCount(1, false)).toBe("1 container");
  });
});
