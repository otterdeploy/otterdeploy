/** Mock service catalog backing the "Open a terminal" picker. Swap for an
 *  oRPC query once the server can enumerate live containers. */

export type ServiceReplica = {
  /** Real container ID we hand to the WebSocket — `?container=…`. */
  containerId: string;
  /** Short replica label shown in the picker pill (r1, r2, …). */
  label: string;
};

export type Service = {
  name: string;
  project: string;
  replicas: ServiceReplica[];
};

export const MOCK_SERVICES: Service[] = [
  {
    name: "web",
    project: "helio",
    replicas: [
      { containerId: "helio-web-r1", label: "r1" },
      { containerId: "helio-web-r2", label: "r2" },
      { containerId: "helio-web-r3", label: "r3" },
    ],
  },
  {
    name: "api",
    project: "helio",
    replicas: [
      { containerId: "helio-api-r1", label: "r1" },
      { containerId: "helio-api-r2", label: "r2" },
      { containerId: "helio-api-r3", label: "r3" },
      { containerId: "helio-api-r4", label: "r4" },
    ],
  },
  {
    name: "worker",
    project: "helio",
    replicas: [
      { containerId: "helio-worker-r1", label: "r1" },
      { containerId: "helio-worker-r2", label: "r2" },
    ],
  },
  {
    name: "imgproxy",
    project: "helio",
    replicas: [{ containerId: "helio-imgproxy-r1", label: "r1" }],
  },
  {
    name: "billing-api",
    project: "billing",
    replicas: [{ containerId: "billing-api-r1", label: "r1" }],
  },
  {
    name: "marketing-web",
    project: "marketing-site",
    replicas: [
      { containerId: "marketing-web-r1", label: "r1" },
      { containerId: "marketing-web-r2", label: "r2" },
    ],
  },
];

export type SwarmNode = {
  name: string;
  host: string;
  /** "local" runs as a host shell on the machine running the server (no SSH
   *  hop). "remote" SSHes into a swarm node. */
  kind: "local" | "remote";
};

export const MOCK_NODES: SwarmNode[] = [
  { name: "localhost", host: "this machine · host shell", kind: "local" },
  { name: "helio-prod-01", host: "10.0.4.11", kind: "remote" },
  { name: "helio-prod-02", host: "10.0.4.12", kind: "remote" },
  { name: "helio-prod-03", host: "10.0.4.13", kind: "remote" },
];

export type Database = {
  name: string;
  engine: "postgres" | "redis" | "mongodb" | "mysql" | "mariadb";
  project: string;
};

export const MOCK_DATABASES: Database[] = [
  { name: "postgres", engine: "postgres", project: "helio" },
  { name: "redis", engine: "redis", project: "helio" },
  { name: "events", engine: "mongodb", project: "helio" },
];
