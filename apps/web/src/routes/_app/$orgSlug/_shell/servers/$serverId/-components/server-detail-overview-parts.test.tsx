import { renderToStaticMarkup } from "react-dom/server";

import { idSchema } from "@otterdeploy/shared/id";
import { describe, expect, it } from "vite-plus/test";

import type { Server } from "@/features/servers/data/server";

import { KeyValueList } from "./server-detail-parts";
import { machineFacts, machineRegistration } from "./server-detail-overview-parts";

const at = new Date(0);

const worker: Server = {
  id: idSchema.server.parse("srv_w1"),
  organizationId: "org_a",
  name: "w1",
  hostname: "w1-host",
  host: "203.0.113.41",
  region: null,
  role: "worker",
  status: "ready",
  availability: "active",
  cpuTotal: 2,
  memTotalGb: 8,
  diskTotalGb: 80,
  diskUnit: "GB",
  daemonVersion: null,
  provisionStatus: "ready",
  provisionError: null,
  sshKeyId: null,
  sshUser: "root",
  sshPort: 22,
  meshProvider: "netbird",
  meshAddress: "100.92.14.7",
  buildServer: false,
  buildLane: null,
  edgeProxyStatus: "unknown",
  edgeProxyError: null,
  firewallStatus: "applied",
  firewallAppliedAt: null,
  firewallError: null,
  firewallBouncerActive: false,
  labels: [],
  joinedAt: at,
  createdAt: at,
  updatedAt: at,
  address: "203.0.113.41",
};

const controlPlane: Server = {
  ...worker,
  name: "localhost",
  host: "127.0.0.1",
  labels: ["bootstrap"],
  meshProvider: "none",
  meshAddress: null,
  address: null,
  addressHidden: true,
};

function html(items: ReturnType<typeof machineFacts>): string {
  return renderToStaticMarkup(<KeyValueList items={items} />);
}

describe("Overview › About this machine", () => {
  it("masks the host and the mesh address, keeping the provider readable", () => {
    const out = html(machineFacts(worker, null));
    expect(out).not.toContain("203.0.113.41");
    expect(out).not.toContain("100.92.14.7");
    expect(out).toContain("netbird");
    expect(out).toContain('aria-label="Reveal host"');
    expect(out).toContain('aria-label="Reveal mesh address"');
  });

  it("shows the control plane's address as withheld, with nothing to reveal", () => {
    const out = html(machineFacts(controlPlane, null));
    expect(out).toContain("Only installation admins can see");
    expect(out).not.toContain('aria-label="Reveal host"');
  });
});

describe("Settings › Machine", () => {
  it("masks the SSH host, keeping the user and port readable", () => {
    const out = html(machineRegistration(worker));
    expect(out).not.toContain("203.0.113.41");
    expect(out).not.toContain("100.92.14.7");
    expect(out).toContain("root@");
    expect(out).toContain(":22");
    expect(out).toContain('aria-label="Reveal SSH host"');
  });
});
