/**
 * Lab topologies as data. Adding a machine (w2 in hel1, w3 in ash, drv, emu,
 * mesh) is one more entry here, not new code: provisioning, DNS, firewalling,
 * budget and teardown all iterate over `nodes`.
 *
 * Design: research/adversarial-testing/09-vm-lab.md §2.1.
 */

export type NodeRole = "control-plane" | "worker" | "driver" | "emulator" | "mesh";

export interface LabNode {
  /** Short name; the server is `<name>-<run>` and DNS is `<name>.<run>.<suffix>`. */
  name: string;
  role: NodeRole;
  serverType: string;
  location: string;
  /** Pinned address on the run's private network; null = public only (e.g. ash). */
  privateIp: string | null;
}

export interface LabTopology {
  name: string;
  image: string;
  network: { ipRange: string; subnet: string; zone: string };
  nodes: readonly LabNode[];
}

const network = { ipRange: "10.42.0.0/16", subnet: "10.42.0.0/24", zone: "eu-central" } as const;

/** First smoke run: one control plane and one same-site worker. */
const smoke: LabTopology = {
  name: "smoke",
  image: "ubuntu-24.04",
  network,
  nodes: [
    {
      name: "cp",
      role: "control-plane",
      serverType: "cpx32",
      location: "nbg1",
      privateIp: "10.42.0.2",
    },
    { name: "w1", role: "worker", serverType: "cpx22", location: "nbg1", privateIp: "10.42.0.11" },
  ],
};

export const TOPOLOGIES: Record<string, LabTopology> = { smoke };

export function topologyNamed(name: string): LabTopology | undefined {
  return TOPOLOGIES[name];
}
