// Docker — raw view of the Docker daemon on each swarm node.
// Use for debugging when something is stuck below the Stack/Service abstraction.

import { useMemo, useState } from "react";

import { I } from "../icons";
import { NODES } from "../data";

type Tab = "containers" | "images" | "volumes" | "networks" | "tasks";

type ContainerStatus = "running" | "exited" | "restarting" | "paused";
type Container = {
  id: string;
  image: string;
  command: string;
  created: string;
  status: ContainerStatus;
  statusDetail: string;
  ports: string;
  name: string;
  node: string;
};

type Image = {
  repo: string;
  tag: string;
  id: string;
  created: string;
  size: string;
  inUse: number;
};

type Volume = {
  name: string;
  driver: string;
  mountpoint: string;
  size: string;
  inUse: number;
  created: string;
};

type Network = {
  name: string;
  driver: "bridge" | "overlay" | "host" | "null";
  scope: "swarm" | "local";
  subnet: string;
  gateway: string;
  attached: number;
};

type SwarmTaskState = "running" | "ready" | "shutdown" | "rejected" | "failed" | "preparing";
type SwarmTask = {
  id: string;
  service: string;
  slot: number;
  image: string;
  node: string;
  desired: SwarmTaskState;
  current: SwarmTaskState;
  error?: string;
  age: string;
};

const STATUS_TONE: Record<ContainerStatus, string> = {
  running: "var(--ok)",
  exited: "var(--err)",
  restarting: "var(--warn)",
  paused: "var(--info)",
};

const TASK_TONE: Record<SwarmTaskState, string> = {
  running: "var(--ok)",
  ready: "var(--info)",
  shutdown: "var(--fg-4)",
  rejected: "var(--err)",
  failed: "var(--err)",
  preparing: "var(--warn)",
};

function shortId(seed: string): string {
  // deterministic 12-char hex from seed
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  let out = "";
  for (let i = 0; i < 12; i++) {
    h = (h * 1103515245 + 12345) >>> 0;
    out += "0123456789abcdef"[h % 16];
  }
  return out;
}

const NODE_IDS = NODES.map((n) => n.name);

const CONTAINERS: Container[] = [
  { id: shortId("web-r1"), image: "registry.helio.internal/web:8a2c1f9", command: "node server.js", created: "4m ago", status: "running", statusDetail: "Up 4 minutes (healthy)", ports: "3000/tcp", name: "helio_web.1", node: NODE_IDS[0]! },
  { id: shortId("web-r2"), image: "registry.helio.internal/web:8a2c1f9", command: "node server.js", created: "4m ago", status: "running", statusDetail: "Up 4 minutes (healthy)", ports: "3000/tcp", name: "helio_web.2", node: NODE_IDS[1]! },
  { id: shortId("web-r3"), image: "registry.helio.internal/web:8a2c1f9", command: "node server.js", created: "4m ago", status: "running", statusDetail: "Up 4 minutes (healthy)", ports: "3000/tcp", name: "helio_web.3", node: NODE_IDS[2]! },
  { id: shortId("api-r1"), image: "registry.helio.internal/api:3f9b042", command: "node dist/server.js", created: "11m ago", status: "running", statusDetail: "Up 11 minutes (healthy)", ports: "8080/tcp", name: "helio_api.1", node: NODE_IDS[0]! },
  { id: shortId("api-r2"), image: "registry.helio.internal/api:3f9b042", command: "node dist/server.js", created: "11m ago", status: "running", statusDetail: "Up 11 minutes (healthy)", ports: "8080/tcp", name: "helio_api.2", node: NODE_IDS[1]! },
  { id: shortId("api-r3"), image: "registry.helio.internal/api:3f9b042", command: "node dist/server.js", created: "11m ago", status: "running", statusDetail: "Up 11 minutes (healthy)", ports: "8080/tcp", name: "helio_api.3", node: NODE_IDS[2]! },
  { id: shortId("api-r4"), image: "registry.helio.internal/api:3f9b042", command: "node dist/server.js", created: "2h ago", status: "restarting", statusDetail: "Restarting (1) 14 seconds ago", ports: "8080/tcp", name: "helio_api.4", node: NODE_IDS[2]! },
  { id: shortId("postgres"), image: "postgres:16.2", command: "docker-entrypoint.sh postgres", created: "62d ago", status: "running", statusDetail: "Up 62 days (healthy)", ports: "5432/tcp", name: "helio_postgres.1", node: NODE_IDS[0]! },
  { id: shortId("redis"), image: "redis:7.2-alpine", command: "redis-server /etc/redis.conf", created: "62d ago", status: "running", statusDetail: "Up 62 days (healthy)", ports: "6379/tcp", name: "helio_redis.1", node: NODE_IDS[0]! },
  { id: shortId("agent"), image: "otterstack/agent:v1.4.2", command: "/agent --node", created: "62d ago", status: "running", statusDetail: "Up 62 days", ports: "", name: "otterstack-agent", node: NODE_IDS[0]! },
  { id: shortId("caddy"), image: "caddy:2.8-alpine", command: "caddy run --config /etc/caddy/Caddyfile", created: "12d ago", status: "running", statusDetail: "Up 12 days (healthy)", ports: "80/tcp,443/tcp,443/udp", name: "helio_caddy-edge.1", node: NODE_IDS[0]! },
  { id: shortId("worker"), image: "registry.helio.internal/worker:c1ad5e2", command: "celery -A app worker -c 8", created: "38m ago", status: "running", statusDetail: "Up 38 minutes", ports: "", name: "helio_worker.1", node: NODE_IDS[1]! },
  { id: shortId("worker2"), image: "registry.helio.internal/worker:c1ad5e2", command: "celery -A app worker -c 8", created: "38m ago", status: "running", statusDetail: "Up 38 minutes", ports: "", name: "helio_worker.2", node: NODE_IDS[2]! },
  { id: shortId("imgproxy"), image: "darthsim/imgproxy:v3", command: "imgproxy", created: "12d ago", status: "running", statusDetail: "Up 12 days", ports: "8081/tcp", name: "helio_imgproxy.1", node: NODE_IDS[2]! },
  { id: shortId("seed"), image: "registry.helio.internal/api:71fa0c3", command: "node scripts/seed.js", created: "2h ago", status: "exited", statusDetail: "Exited (137) 1 hour ago", ports: "", name: "helio_seed", node: NODE_IDS[1]! },
];

const IMAGES: Image[] = [
  { repo: "registry.helio.internal/web", tag: "8a2c1f9", id: shortId("img-web"), created: "4m ago", size: "184 MB", inUse: 3 },
  { repo: "registry.helio.internal/api", tag: "3f9b042", id: shortId("img-api"), created: "11m ago", size: "212 MB", inUse: 4 },
  { repo: "registry.helio.internal/api", tag: "71fa0c3", id: shortId("img-api-old"), created: "2h ago", size: "211 MB", inUse: 1 },
  { repo: "registry.helio.internal/worker", tag: "c1ad5e2", id: shortId("img-worker"), created: "38m ago", size: "298 MB", inUse: 2 },
  { repo: "postgres", tag: "16.2", id: shortId("img-pg"), created: "3mo ago", size: "428 MB", inUse: 1 },
  { repo: "redis", tag: "7.2-alpine", id: shortId("img-redis"), created: "5mo ago", size: "32 MB", inUse: 1 },
  { repo: "caddy", tag: "2.8-alpine", id: shortId("img-caddy"), created: "12d ago", size: "48 MB", inUse: 1 },
  { repo: "darthsim/imgproxy", tag: "v3", id: shortId("img-img"), created: "84d ago", size: "164 MB", inUse: 1 },
  { repo: "otterstack/agent", tag: "v1.4.2", id: shortId("img-agent"), created: "62d ago", size: "22 MB", inUse: 3 },
  { repo: "<none>", tag: "<none>", id: shortId("img-dangling"), created: "9d ago", size: "176 MB", inUse: 0 },
];

const VOLUMES: Volume[] = [
  { name: "helio_postgres-data", driver: "local", mountpoint: "/var/lib/docker/volumes/helio_postgres-data/_data", size: "12.4 GB", inUse: 1, created: "62d ago" },
  { name: "helio_redis-data", driver: "local", mountpoint: "/var/lib/docker/volumes/helio_redis-data/_data", size: "118 MB", inUse: 1, created: "62d ago" },
  { name: "helio_caddy-data", driver: "local", mountpoint: "/var/lib/docker/volumes/helio_caddy-data/_data", size: "8.2 MB", inUse: 1, created: "62d ago" },
  { name: "helio_caddy-config", driver: "local", mountpoint: "/var/lib/docker/volumes/helio_caddy-config/_data", size: "412 KB", inUse: 1, created: "62d ago" },
  { name: "helio_image-cache", driver: "local", mountpoint: "/var/lib/docker/volumes/helio_image-cache/_data", size: "4.1 GB", inUse: 0, created: "47d ago" },
  { name: "helio_worker-tmp", driver: "local", mountpoint: "/var/lib/docker/volumes/helio_worker-tmp/_data", size: "284 MB", inUse: 2, created: "9d ago" },
  { name: "helio_minio-data", driver: "local", mountpoint: "/var/lib/docker/volumes/helio_minio-data/_data", size: "2.8 GB", inUse: 0, created: "21d ago" },
];

const NETWORKS: Network[] = [
  { name: "bridge", driver: "bridge", scope: "local", subnet: "172.17.0.0/16", gateway: "172.17.0.1", attached: 1 },
  { name: "host", driver: "host", scope: "local", subnet: "—", gateway: "—", attached: 0 },
  { name: "ingress", driver: "overlay", scope: "swarm", subnet: "10.0.0.0/24", gateway: "10.0.0.1", attached: 8 },
  { name: "helio-mesh", driver: "overlay", scope: "swarm", subnet: "10.0.4.0/24", gateway: "10.0.4.1", attached: 12 },
  { name: "helio-internal", driver: "overlay", scope: "swarm", subnet: "10.0.8.0/24", gateway: "10.0.8.1", attached: 5 },
];

const TASKS: SwarmTask[] = [
  { id: shortId("t-web1"), service: "helio_web", slot: 1, image: "registry.helio.internal/web:8a2c1f9", node: NODE_IDS[0]!, desired: "running", current: "running", age: "4m" },
  { id: shortId("t-web2"), service: "helio_web", slot: 2, image: "registry.helio.internal/web:8a2c1f9", node: NODE_IDS[1]!, desired: "running", current: "running", age: "4m" },
  { id: shortId("t-web3"), service: "helio_web", slot: 3, image: "registry.helio.internal/web:8a2c1f9", node: NODE_IDS[2]!, desired: "running", current: "running", age: "4m" },
  { id: shortId("t-api1"), service: "helio_api", slot: 1, image: "registry.helio.internal/api:3f9b042", node: NODE_IDS[0]!, desired: "running", current: "running", age: "11m" },
  { id: shortId("t-api2"), service: "helio_api", slot: 2, image: "registry.helio.internal/api:3f9b042", node: NODE_IDS[1]!, desired: "running", current: "running", age: "11m" },
  { id: shortId("t-api3"), service: "helio_api", slot: 3, image: "registry.helio.internal/api:3f9b042", node: NODE_IDS[2]!, desired: "running", current: "running", age: "11m" },
  { id: shortId("t-api4"), service: "helio_api", slot: 4, image: "registry.helio.internal/api:3f9b042", node: NODE_IDS[2]!, desired: "running", current: "preparing", age: "14s", error: "starting up — health probe pending" },
  { id: shortId("t-api-old"), service: "helio_api", slot: 4, image: "registry.helio.internal/api:71fa0c3", node: NODE_IDS[2]!, desired: "shutdown", current: "shutdown", age: "2h" },
  { id: shortId("t-w1"), service: "helio_worker", slot: 1, image: "registry.helio.internal/worker:c1ad5e2", node: NODE_IDS[1]!, desired: "running", current: "running", age: "38m" },
  { id: shortId("t-w2"), service: "helio_worker", slot: 2, image: "registry.helio.internal/worker:c1ad5e2", node: NODE_IDS[2]!, desired: "running", current: "running", age: "38m" },
  { id: shortId("t-pg"), service: "helio_postgres", slot: 1, image: "postgres:16.2", node: NODE_IDS[0]!, desired: "running", current: "running", age: "62d" },
  { id: shortId("t-redis"), service: "helio_redis", slot: 1, image: "redis:7.2-alpine", node: NODE_IDS[0]!, desired: "running", current: "running", age: "62d" },
  { id: shortId("t-img"), service: "helio_imgproxy", slot: 1, image: "darthsim/imgproxy:v3", node: NODE_IDS[2]!, desired: "running", current: "running", age: "12d" },
  { id: shortId("t-caddy"), service: "helio_caddy-edge", slot: 1, image: "caddy:2.8-alpine", node: NODE_IDS[0]!, desired: "running", current: "running", age: "12d" },
  { id: shortId("t-fail"), service: "helio_worker", slot: 3, image: "registry.helio.internal/worker:fe19a02", node: NODE_IDS[1]!, desired: "shutdown", current: "failed", age: "2d", error: "task: non-zero exit (1)" },
];

export function DockerRaw() {
  const [tab, setTab] = useState<Tab>("containers");
  const [node, setNode] = useState<string>("all");

  const tabs: Array<[Tab, string, number]> = [
    ["containers", "Containers", CONTAINERS.length],
    ["images", "Images", IMAGES.length],
    ["volumes", "Volumes", VOLUMES.length],
    ["networks", "Networks", NETWORKS.length],
    ["tasks", "Tasks", TASKS.length],
  ];

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {/* Header */}
      <div style={{ padding: "16px 20px 10px", borderBottom: "1px solid var(--border)" }}>
        <div className="row gap-2" style={{ alignItems: "center" }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Docker</h2>
            <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
              Raw view of the Docker daemon on each swarm node. Use for debugging when something is stuck below the Stack/Service abstraction.
            </div>
          </div>
          <div style={{ flex: 1 }} />
          <select
            className="input"
            value={node}
            onChange={(e) => setNode(e.target.value)}
            style={{ width: 200, height: 30 }}
          >
            <option value="all">All nodes</option>
            {NODES.map((n) => (
              <option key={n.id} value={n.name}>
                {n.name} ({n.host})
              </option>
            ))}
          </select>
        </div>

        {/* Sub-tabs */}
        <div className="row gap-1" style={{ marginTop: 14 }}>
          {tabs.map(([id, lab, n]) => {
            const active = tab === id;
            return (
              <button
                key={id}
                onClick={() => setTab(id)}
                style={{
                  padding: "6px 12px",
                  fontSize: 12,
                  borderRadius: 6,
                  background: active ? "var(--bg-elev)" : "transparent",
                  color: active ? "var(--fg)" : "var(--fg-3)",
                  fontWeight: active ? 500 : 400,
                  border: `1px solid ${active ? "var(--border-strong)" : "transparent"}`,
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <span>{lab}</span>
                <span className="mono" style={{ fontSize: 10, color: "var(--fg-4)" }}>{n}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div style={{ flex: 1, overflow: "auto" }} className="os-scroll">
        {tab === "containers" && <ContainersTable nodeFilter={node} />}
        {tab === "images" && <ImagesTable />}
        {tab === "volumes" && <VolumesTable />}
        {tab === "networks" && <NetworksTable />}
        {tab === "tasks" && <TasksTable nodeFilter={node} />}
      </div>
    </div>
  );
}

function ContainersTable({ nodeFilter }: { nodeFilter: string }) {
  const rows = useMemo(
    () => (nodeFilter === "all" ? CONTAINERS : CONTAINERS.filter((c) => c.node === nodeFilter)),
    [nodeFilter],
  );
  const exec = (c: Container) => {
    // Placeholder — would open TerminalWorkspace in a modal in a future pass.
    // eslint-disable-next-line no-console
    console.log("[docker-raw] exec", c.name, "on", c.node);
  };
  const inspect = (c: Container) => {
    // eslint-disable-next-line no-console
    console.log("[docker-raw] inspect", c.id);
  };
  const logs = (c: Container) => {
    // eslint-disable-next-line no-console
    console.log("[docker-raw] logs", c.name);
  };

  return (
    <div style={{ padding: 16 }}>
      <div className="card" style={{ overflow: "hidden" }}>
        <div className="os-pe-head" style={{ padding: "10px 14px" }}>
          <span style={{ width: 110 }}>Container ID</span>
          <span style={{ flex: 1.6, minWidth: 200 }}>Image</span>
          <span style={{ flex: 1.4, minWidth: 180 }}>Command</span>
          <span style={{ width: 90 }}>Created</span>
          <span style={{ width: 200 }}>Status</span>
          <span style={{ width: 130 }}>Ports</span>
          <span style={{ flex: 1, minWidth: 140 }}>Name</span>
          <span style={{ width: 110 }}>Node</span>
          <span style={{ width: 170, textAlign: "right" }}>Actions</span>
        </div>
        {rows.map((c, i) => (
          <div
            key={c.id}
            className="row"
            style={{
              padding: "8px 14px",
              borderTop: i > 0 ? "1px solid var(--border)" : "none",
              fontSize: 12,
              alignItems: "center",
            }}
          >
            <span style={{ width: 110 }} className="mono">{c.id}</span>
            <span style={{ flex: 1.6, minWidth: 200 }} className="mono" title={c.image}>
              <Truncate text={c.image} />
            </span>
            <span style={{ flex: 1.4, minWidth: 180 }} className="mono muted" title={c.command}>
              <Truncate text={c.command} />
            </span>
            <span style={{ width: 90 }} className="mono muted">{c.created}</span>
            <span style={{ width: 200 }}>
              <span
                className="badge"
                style={{
                  background: `color-mix(in srgb, ${STATUS_TONE[c.status]} 12%, transparent)`,
                  color: STATUS_TONE[c.status],
                  borderColor: `color-mix(in srgb, ${STATUS_TONE[c.status]} 28%, transparent)`,
                }}
                title={c.statusDetail}
              >
                <span className="dot" style={{ background: STATUS_TONE[c.status] }} />
                {c.statusDetail}
              </span>
            </span>
            <span style={{ width: 130 }} className="mono muted">{c.ports || "—"}</span>
            <span style={{ flex: 1, minWidth: 140, fontWeight: 500 }}>{c.name}</span>
            <span style={{ width: 110 }} className="mono muted">{c.node}</span>
            <span style={{ width: 170, textAlign: "right" }}>
              <div className="row gap-1" style={{ justifyContent: "flex-end" }}>
                <button className="btn sm" onClick={() => logs(c)}>Logs</button>
                <button className="btn sm ghost" onClick={() => inspect(c)}>Inspect</button>
                <button className="btn sm ghost" onClick={() => exec(c)} disabled={c.status !== "running"}>
                  <I.bolt width={10} height={10} /> Exec
                </button>
              </div>
            </span>
          </div>
        ))}
        {rows.length === 0 && (
          <div style={{ padding: 30, textAlign: "center", color: "var(--fg-3)", fontSize: 13 }}>
            No containers running on this node.
          </div>
        )}
      </div>
    </div>
  );
}

function ImagesTable() {
  return (
    <div style={{ padding: 16 }}>
      <div className="card" style={{ overflow: "hidden" }}>
        <div className="os-pe-head" style={{ padding: "10px 14px" }}>
          <span style={{ flex: 2, minWidth: 220 }}>Repository</span>
          <span style={{ width: 130 }}>Tag</span>
          <span style={{ width: 120 }}>Image ID</span>
          <span style={{ width: 100 }}>Created</span>
          <span style={{ width: 90 }}>Size</span>
          <span style={{ width: 90 }}>In use</span>
          <span style={{ width: 200, textAlign: "right" }}>Actions</span>
        </div>
        {IMAGES.map((img, i) => (
          <div
            key={img.id}
            className="row"
            style={{
              padding: "8px 14px",
              borderTop: i > 0 ? "1px solid var(--border)" : "none",
              fontSize: 12,
              alignItems: "center",
            }}
          >
            <span style={{ flex: 2, minWidth: 220, fontWeight: img.repo === "<none>" ? 400 : 500 }} className="mono">
              {img.repo}
            </span>
            <span style={{ width: 130 }} className="mono muted">{img.tag}</span>
            <span style={{ width: 120 }} className="mono">{img.id}</span>
            <span style={{ width: 100 }} className="mono muted">{img.created}</span>
            <span style={{ width: 90 }} className="mono muted">{img.size}</span>
            <span style={{ width: 90 }}>
              {img.inUse > 0 ? (
                <span className="badge ok"><span className="dot" />{img.inUse}</span>
              ) : (
                <span className="badge"><span className="dot" style={{ background: "var(--fg-4)" }} />unused</span>
              )}
            </span>
            <span style={{ width: 200, textAlign: "right" }}>
              <div className="row gap-1" style={{ justifyContent: "flex-end" }}>
                <button className="btn sm">Pull</button>
                <button className="btn sm ghost">Inspect</button>
                <button
                  className="btn sm ghost"
                  style={img.inUse === 0 ? { color: "var(--err)" } : undefined}
                  disabled={img.inUse > 0}
                >
                  Remove
                </button>
              </div>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function VolumesTable() {
  return (
    <div style={{ padding: 16 }}>
      <div className="card" style={{ overflow: "hidden" }}>
        <div className="os-pe-head" style={{ padding: "10px 14px" }}>
          <span style={{ flex: 1.2, minWidth: 200 }}>Name</span>
          <span style={{ width: 80 }}>Driver</span>
          <span style={{ flex: 2, minWidth: 280 }}>Mountpoint</span>
          <span style={{ width: 90 }}>Size</span>
          <span style={{ width: 80 }}>In use</span>
          <span style={{ width: 100 }}>Created</span>
          <span style={{ width: 130, textAlign: "right" }}>Actions</span>
        </div>
        {VOLUMES.map((v, i) => (
          <div
            key={v.name}
            className="row"
            style={{
              padding: "8px 14px",
              borderTop: i > 0 ? "1px solid var(--border)" : "none",
              fontSize: 12,
              alignItems: "center",
            }}
          >
            <span style={{ flex: 1.2, minWidth: 200, fontWeight: 500 }} className="mono">{v.name}</span>
            <span style={{ width: 80 }} className="mono muted">{v.driver}</span>
            <span style={{ flex: 2, minWidth: 280, color: "var(--fg-3)" }} className="mono" title={v.mountpoint}>
              <Truncate text={v.mountpoint} />
            </span>
            <span style={{ width: 90 }} className="mono">{v.size}</span>
            <span style={{ width: 80 }}>
              {v.inUse > 0 ? (
                <span className="badge ok"><span className="dot" />{v.inUse}</span>
              ) : (
                <span className="badge warn"><span className="dot" />orphan</span>
              )}
            </span>
            <span style={{ width: 100 }} className="mono muted">{v.created}</span>
            <span style={{ width: 130, textAlign: "right" }}>
              <div className="row gap-1" style={{ justifyContent: "flex-end" }}>
                <button className="btn sm ghost">Inspect</button>
                <button
                  className="btn sm ghost"
                  style={v.inUse === 0 ? { color: "var(--err)" } : undefined}
                  disabled={v.inUse > 0}
                >
                  Remove
                </button>
              </div>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function NetworksTable() {
  return (
    <div style={{ padding: 16 }}>
      <div className="card" style={{ overflow: "hidden" }}>
        <div className="os-pe-head" style={{ padding: "10px 14px" }}>
          <span style={{ flex: 1.2, minWidth: 160 }}>Name</span>
          <span style={{ width: 90 }}>Driver</span>
          <span style={{ width: 80 }}>Scope</span>
          <span style={{ width: 140 }}>Subnet</span>
          <span style={{ width: 130 }}>Gateway</span>
          <span style={{ width: 110 }}>Attached</span>
          <span style={{ width: 130, textAlign: "right" }}>Actions</span>
        </div>
        {NETWORKS.map((n, i) => (
          <div
            key={n.name}
            className="row"
            style={{
              padding: "8px 14px",
              borderTop: i > 0 ? "1px solid var(--border)" : "none",
              fontSize: 12,
              alignItems: "center",
            }}
          >
            <span style={{ flex: 1.2, minWidth: 160, fontWeight: 500 }} className="mono">{n.name}</span>
            <span style={{ width: 90 }}>
              <span
                className="badge"
                style={{
                  background:
                    n.driver === "overlay"
                      ? "color-mix(in srgb, var(--info) 12%, transparent)"
                      : "var(--bg-overlay)",
                  color: n.driver === "overlay" ? "var(--info)" : "var(--fg-3)",
                }}
              >
                {n.driver}
              </span>
            </span>
            <span style={{ width: 80 }} className="mono muted">{n.scope}</span>
            <span style={{ width: 140 }} className="mono">{n.subnet}</span>
            <span style={{ width: 130 }} className="mono muted">{n.gateway}</span>
            <span style={{ width: 110 }} className="mono">{n.attached} containers</span>
            <span style={{ width: 130, textAlign: "right" }}>
              <div className="row gap-1" style={{ justifyContent: "flex-end" }}>
                <button className="btn sm ghost">Inspect</button>
                <button
                  className="btn sm ghost"
                  disabled={n.scope === "swarm" || n.driver === "host" || n.name === "bridge"}
                >
                  Remove
                </button>
              </div>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function TasksTable({ nodeFilter }: { nodeFilter: string }) {
  const rows = useMemo(
    () => (nodeFilter === "all" ? TASKS : TASKS.filter((t) => t.node === nodeFilter)),
    [nodeFilter],
  );
  return (
    <div style={{ padding: 16 }}>
      <div className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
        Swarm tasks are the actual scheduling units the orchestrator created from each Stack service.
      </div>
      <div className="card" style={{ overflow: "hidden" }}>
        <div className="os-pe-head" style={{ padding: "10px 14px" }}>
          <span style={{ width: 120 }}>Task ID</span>
          <span style={{ flex: 1.2, minWidth: 150 }}>Service</span>
          <span style={{ width: 60 }}>Slot</span>
          <span style={{ flex: 1.6, minWidth: 220 }}>Image</span>
          <span style={{ width: 110 }}>Node</span>
          <span style={{ width: 100 }}>Desired</span>
          <span style={{ width: 100 }}>Current</span>
          <span style={{ width: 70 }}>Age</span>
          <span style={{ flex: 1.2, minWidth: 180 }}>Error</span>
        </div>
        {rows.map((t, i) => (
          <div
            key={t.id}
            className="row"
            style={{
              padding: "8px 14px",
              borderTop: i > 0 ? "1px solid var(--border)" : "none",
              fontSize: 12,
              alignItems: "center",
            }}
          >
            <span style={{ width: 120 }} className="mono">{t.id}</span>
            <span style={{ flex: 1.2, minWidth: 150, fontWeight: 500 }} className="mono">{t.service}</span>
            <span style={{ width: 60 }} className="mono muted">{t.slot}</span>
            <span style={{ flex: 1.6, minWidth: 220 }} className="mono muted" title={t.image}>
              <Truncate text={t.image} />
            </span>
            <span style={{ width: 110 }} className="mono muted">{t.node}</span>
            <span style={{ width: 100 }}>
              <span className="mono" style={{ color: TASK_TONE[t.desired], fontSize: 11 }}>
                {t.desired}
              </span>
            </span>
            <span style={{ width: 100 }}>
              <span
                className="badge"
                style={{
                  background: `color-mix(in srgb, ${TASK_TONE[t.current]} 12%, transparent)`,
                  color: TASK_TONE[t.current],
                  borderColor: `color-mix(in srgb, ${TASK_TONE[t.current]} 28%, transparent)`,
                }}
              >
                <span className="dot" style={{ background: TASK_TONE[t.current] }} />
                {t.current}
              </span>
            </span>
            <span style={{ width: 70 }} className="mono muted">{t.age}</span>
            <span
              style={{
                flex: 1.2,
                minWidth: 180,
                color: t.error ? "var(--err)" : "var(--fg-4)",
                fontSize: 11,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
              title={t.error || ""}
            >
              {t.error || "—"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Truncate({ text }: { text: string }) {
  return (
    <span
      style={{
        display: "inline-block",
        maxWidth: "100%",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        verticalAlign: "bottom",
      }}
    >
      {text}
    </span>
  );
}
