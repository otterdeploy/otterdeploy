// Infra/cluster metadata types — split out of service-kinds.ts to keep that
// file focused on the create-wizard picker data. Re-exported from
// service-kinds.ts so existing import paths keep working.

export interface Template {
  id: string;
  name: string;
  sub: string;
  services: number;
  popular?: boolean;
  icon: string;
}

export type NodeRole = "manager" | "worker";
export type NodeStatus = "ready" | "draining" | "down";
export type NodeAvailability = "active" | "drain" | "pause";

export interface Node {
  id: string;
  name: string;
  region: string;
  host: string;
  cpu: { used: number; total: number };
  mem: { used: number; total: number };
  disk?: { used: number; total: number; unit: string };
  services: number;
  status: NodeStatus;
  role: NodeRole;
  availability: NodeAvailability;
  joined: string;
  daemonVersion: string;
  labels?: string[];
  project?: string;
}

export interface Builder {
  id: string;
  name: string;
  sub: string;
  icon: string;
  popular?: boolean;
  langs?: string[];
}
