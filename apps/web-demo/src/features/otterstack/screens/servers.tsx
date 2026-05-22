// Servers — list / add / manage Docker Swarm nodes that back the cluster.
// Replicas land on these nodes via Docker Stack rolling updates.

import { useEffect, useMemo, useState } from "react";

import { I } from "../icons";
import {
  NODES,
  REGIONS,
  SWARM_JOIN_TOKEN_MANAGER,
  SWARM_JOIN_TOKEN_WORKER,
  SWARM_MANAGER_ADDR,
  type Node,
  type NodeRole,
} from "../data";
import { TerminalWorkspace, sshTarget } from "../components/terminal-workspace";
import {
  ALL_PROJECTS,
  ProjectFilterStrip,
  ProjectPicker,
  matchesProjectFilter,
} from "../components/project-filter";
import { PROJECTS } from "../data";

export function Servers() {
  const [nodes, setNodes] = useState<Node[]>(NODES);
  const [openNode, setOpenNode] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [filter, setFilter] = useState<string>(ALL_PROJECTS);

  const filteredNodes = useMemo(
    () => nodes.filter((n) => matchesProjectFilter(filter, n.project ? [n.project] : [])),
    [nodes, filter],
  );

  // Per-project counts for the strip — count nodes pinned to a project,
  // and count "general pool" nodes (untagged) under every project too.
  const counts = useMemo(() => {
    const out: Record<string, number> = {};
    for (const p of PROJECTS) {
      out[p.id] = nodes.filter((n) => !n.project || n.project === p.id).length;
    }
    return out;
  }, [nodes]);

  const totals = useMemo(() => {
    const cpuUsed = filteredNodes.reduce((s, n) => s + n.cpu.used, 0);
    const cpuTotal = filteredNodes.reduce((s, n) => s + n.cpu.total, 0);
    const memUsed = filteredNodes.reduce((s, n) => s + n.mem.used, 0);
    const memTotal = filteredNodes.reduce((s, n) => s + n.mem.total, 0);
    const services = filteredNodes.reduce((s, n) => s + n.services, 0);
    return { cpuUsed, cpuTotal, memUsed, memTotal, services };
  }, [filteredNodes]);

  const setAvailability = (id: string, av: Node["availability"]) =>
    setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, availability: av } : n)));
  const setProject = (id: string, project: string | undefined) =>
    setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, project } : n)));
  const remove = (id: string) => {
    setNodes((ns) => ns.filter((n) => n.id !== id));
    setOpenNode(null);
  };
  const addNode = (n: Node) => setNodes((ns) => [...ns, n]);

  const opening = nodes.find((n) => n.id === openNode);

  return (
    <div className="os-scroll" style={{ flex: 1, overflow: "auto", padding: 24 }}>
      <div style={{ maxWidth: 1200, margin: "0 auto" }}>
        <div className="row" style={{ marginBottom: 16 }}>
          <SectionH
            title="Servers"
            sub={`${nodes.length} nodes in this swarm · replicas placed via Docker Stack rolling updates`}
          />
          <div style={{ flex: 1 }} />
          <button className="btn" onClick={() => setAddOpen(true)}>
            <I.copy width={12} height={12} /> Join token
          </button>
          <button className="btn primary" onClick={() => setAddOpen(true)}>
            <I.plus width={13} height={13} /> Add server
          </button>
        </div>

        <div className="row" style={{ marginBottom: 16 }}>
          <ProjectFilterStrip active={filter} onChange={setFilter} counts={counts} />
          <div style={{ flex: 1 }} />
          {filter !== ALL_PROJECTS && (
            <span className="muted" style={{ fontSize: 11 }}>
              Showing nodes tagged for{" "}
              <span className="mono" style={{ color: "var(--fg-2)" }}>
                {filter}
              </span>
              {" "}+ general pool
            </span>
          )}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 24 }}>
          <Stat
            label="Cluster CPU"
            value={`${totals.cpuUsed.toFixed(1)} / ${totals.cpuTotal} vCPU`}
            sub={`${Math.round((totals.cpuUsed / totals.cpuTotal) * 100)}% allocated`}
          />
          <Stat
            label="Cluster memory"
            value={`${totals.memUsed} / ${totals.memTotal} GB`}
            sub={`${Math.round((totals.memUsed / totals.memTotal) * 100)}% used`}
          />
          <Stat label="Tasks running" value={`${totals.services}`} sub="across all replicas" />
          <Stat
            label="Manager nodes"
            value={`${nodes.filter((n) => n.role === "manager").length} / ${nodes.length}`}
            sub="quorum healthy"
          />
        </div>

        <div className="card" style={{ overflow: "hidden" }}>
          <div
            className="row"
            style={{
              padding: "10px 14px",
              borderBottom: "1px solid var(--border)",
              fontSize: 11,
              color: "var(--fg-3)",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              background: "var(--bg-sunken)",
            }}
          >
            <span style={{ width: 200 }}>Hostname</span>
            <span style={{ width: 100 }}>Role</span>
            <span style={{ width: 110 }}>Availability</span>
            <span style={{ width: 110 }}>Region</span>
            <span style={{ flex: 1 }}>CPU · memory</span>
            <span style={{ width: 70, textAlign: "right" }}>Tasks</span>
            <span style={{ width: 90, textAlign: "right" }}>Status</span>
            <span style={{ width: 28 }} />
          </div>
          {filteredNodes.length === 0 && (
            <div style={{ padding: 24, textAlign: "center", color: "var(--fg-3)", fontSize: 12 }}>
              No nodes match this filter.
            </div>
          )}
          {filteredNodes.map((n, i) => (
            <ServerRow
              key={n.id}
              n={n}
              borderTop={i > 0}
              onOpen={() => setOpenNode(n.id)}
              onAvailability={(av) => setAvailability(n.id, av)}
            />
          ))}
        </div>
      </div>

      {opening && (
        <ServerDetail
          n={opening}
          onClose={() => setOpenNode(null)}
          onAvailability={(av) => setAvailability(opening.id, av)}
          onProject={(project) => setProject(opening.id, project)}
          onRemove={() => remove(opening.id)}
        />
      )}

      {addOpen && <AddServerModal onClose={() => setAddOpen(false)} onAdd={addNode} />}
    </div>
  );
}

function SectionH({ title, sub }: { title: string; sub?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
      <h3 style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>{title}</h3>
      {sub && (
        <span className="muted" style={{ fontSize: 12 }}>
          {sub}
        </span>
      )}
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="card" style={{ padding: 14 }}>
      <div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em" }}>
        {label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.02em", marginTop: 4 }}>{value}</div>
      <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
        {sub}
      </div>
    </div>
  );
}

function ServerRow({
  n,
  borderTop,
  onOpen,
  onAvailability,
}: {
  n: Node;
  borderTop: boolean;
  onOpen: () => void;
  onAvailability: (av: Node["availability"]) => void;
}) {
  const cpuPct = (n.cpu.used / n.cpu.total) * 100;
  const memPct = (n.mem.used / n.mem.total) * 100;
  return (
    <div
      className="row"
      style={{
        padding: "12px 14px",
        borderTop: borderTop ? "1px solid var(--border)" : "none",
        fontSize: 12,
      }}
    >
      <span style={{ width: 230, display: "flex", alignItems: "center", gap: 8 }}>
        <I.server width={13} height={13} style={{ color: "var(--fg-3)" }} />
        <span className="col" style={{ gap: 2, alignItems: "flex-start", lineHeight: 1.2, minWidth: 0 }}>
          <span className="mono" style={{ fontWeight: 500 }}>
            {n.name}
          </span>
          <span className="muted mono" style={{ fontSize: 10 }}>
            {n.host}
          </span>
          {n.project ? (
            <ProjectTagBadgeReadOnly id={n.project} />
          ) : (
            <span className="muted" style={{ fontSize: 10 }}>
              general pool
            </span>
          )}
        </span>
      </span>
      <span style={{ width: 100 }}>
        <RoleBadge role={n.role} />
      </span>
      <span style={{ width: 110 }}>
        <select
          value={n.availability}
          onChange={(e) => onAvailability(e.target.value as Node["availability"])}
          className="input mono"
          style={{ height: 24, padding: "0 6px", fontSize: 11, width: "92%" }}
        >
          <option value="active">active</option>
          <option value="drain">drain</option>
          <option value="pause">pause</option>
        </select>
      </span>
      <span style={{ width: 110 }}>
        <span className="muted mono">{n.region}</span>
      </span>
      <span style={{ flex: 1, paddingRight: 14 }}>
        <Bar label="cpu" used={n.cpu.used} total={n.cpu.total} unit="vCPU" pct={cpuPct} />
        <Bar label="mem" used={n.mem.used} total={n.mem.total} unit="GB" pct={memPct} />
      </span>
      <span className="mono" style={{ width: 70, textAlign: "right" }}>
        {n.services}
      </span>
      <span style={{ width: 90, textAlign: "right" }}>
        <span className={`badge ${n.status === "ready" ? "ok" : n.status === "draining" ? "warn" : "err"}`}>
          <span className="dot" />
          {n.status}
        </span>
      </span>
      <span style={{ width: 28, textAlign: "right" }}>
        <button className="btn ghost icon sm" onClick={onOpen}>
          <I.chev width={11} height={11} />
        </button>
      </span>
    </div>
  );
}

function RoleBadge({ role }: { role: NodeRole }) {
  return (
    <span
      className="badge mono"
      style={{
        background: role === "manager" ? "var(--info-bg)" : "var(--bg-overlay)",
        color: role === "manager" ? "var(--info)" : "var(--fg-2)",
        borderColor: "transparent",
      }}
    >
      {role}
    </span>
  );
}

function Bar({
  label,
  used,
  total,
  unit,
  pct,
}: {
  label: string;
  used: number;
  total: number;
  unit: string;
  pct: number;
}) {
  return (
    <div style={{ marginBottom: 4 }}>
      <div className="row" style={{ fontSize: 10, color: "var(--fg-3)", marginBottom: 2 }}>
        <span style={{ width: 28 }}>{label}</span>
        <div style={{ flex: 1 }} />
        <span className="mono">
          {used} / {total} {unit}
        </span>
      </div>
      <div style={{ height: 3, background: "var(--bg-overlay)", borderRadius: 2 }}>
        <div
          style={{
            width: `${pct}%`,
            height: "100%",
            borderRadius: 2,
            background: pct > 80 ? "var(--err)" : pct > 60 ? "var(--warn)" : "var(--fg-2)",
          }}
        />
      </div>
    </div>
  );
}

function ServerDetail({
  n,
  onClose,
  onAvailability,
  onProject,
  onRemove,
}: {
  n: Node;
  onClose: () => void;
  onAvailability: (av: Node["availability"]) => void;
  onProject: (project: string | undefined) => void;
  onRemove: () => void;
}) {
  const [tab, setTab] = useState<"overview" | "terminal">("overview");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 200,
        background: "rgba(0,0,0,0.4)",
        display: "flex",
        justifyContent: "flex-end",
        backdropFilter: "blur(2px)",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 560,
          height: "100%",
          background: "var(--bg-elev)",
          borderLeft: "1px solid var(--border)",
          display: "flex",
          flexDirection: "column",
          boxShadow: "var(--shadow-lg)",
        }}
      >
        <div className="row gap-2" style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)" }}>
          <I.server width={14} height={14} />
          <span className="mono" style={{ fontWeight: 600 }}>
            {n.name}
          </span>
          <RoleBadge role={n.role} />
          <span className={`badge ${n.status === "ready" ? "ok" : "warn"}`}>
            <span className="dot" />
            {n.status}
          </span>
          <div style={{ flex: 1 }} />
          <button className="btn ghost icon sm" onClick={onClose}>
            <I.close width={13} height={13} />
          </button>
        </div>

        <div className="row" style={{ borderBottom: "1px solid var(--border)", padding: "0 12px", height: 36 }}>
          <button
            className="os-envtab"
            data-active={tab === "overview"}
            onClick={() => setTab("overview")}
            style={{ height: "100%", borderRight: 0 }}
          >
            <I.home width={11} height={11} /> Overview
            <span className="os-envtab-underline" />
          </button>
          <button
            className="os-envtab"
            data-active={tab === "terminal"}
            onClick={() => setTab("terminal")}
            style={{ height: "100%", borderRight: 0 }}
          >
            <I.bolt width={11} height={11} /> Terminal
            <span className="os-envtab-underline" />
          </button>
        </div>

        {tab === "terminal" ? (
          <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
            <TerminalWorkspace
              key={n.id}
              embedded
              initial={[
                {
                  id: `ssh:${n.id}`,
                  kind: "ssh",
                  title: n.name,
                  subtitle: n.host,
                  projectTags: n.project ? [n.project] : undefined,
                  target: sshTarget(n.name, n.host),
                },
              ]}
            />
          </div>
        ) : (
        <div className="os-scroll col gap-4" style={{ flex: 1, overflow: "auto", padding: 18 }}>
          <div className="row gap-2">
            <button className="btn sm">
              <I.refresh width={11} height={11} /> Reboot
            </button>
            <button
              className="btn sm"
              onClick={() => onAvailability(n.availability === "drain" ? "active" : "drain")}
            >
              <I.download width={11} height={11} /> {n.availability === "drain" ? "Resume" : "Drain"}
            </button>
            <button className="btn sm">
              <I.bolt width={11} height={11} /> Promote
            </button>
            <div style={{ flex: 1 }} />
            <button
              className="btn sm"
              style={{ color: "var(--err)" }}
              onClick={() => {
                if (confirm(`Remove ${n.name} from the swarm?`)) onRemove();
              }}
            >
              <I.trash width={11} height={11} /> Remove
            </button>
          </div>

          <div>
            <div
              className="muted"
              style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}
            >
              Connection
            </div>
            <KV k="Host" v={n.host} mono />
            <KV k="Region" v={`${n.region}`} />
            <KV k="Joined" v={n.joined} />
            <KV k="Daemon" v={n.daemonVersion} mono />
          </div>

          <div>
            <div
              className="muted"
              style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}
            >
              Capacity
            </div>
            <Bar label="cpu" used={n.cpu.used} total={n.cpu.total} unit="vCPU" pct={(n.cpu.used / n.cpu.total) * 100} />
            <Bar label="mem" used={n.mem.used} total={n.mem.total} unit="GB" pct={(n.mem.used / n.mem.total) * 100} />
            {n.disk && (
              <Bar
                label="disk"
                used={n.disk.used}
                total={n.disk.total}
                unit={n.disk.unit}
                pct={(n.disk.used / n.disk.total) * 100}
              />
            )}
            <KV k="Tasks" v={`${n.services} replicas placed`} />
          </div>

          <div>
            <div
              className="muted"
              style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}
            >
              Pinned to project
            </div>
            <ProjectPicker
              value={n.project}
              onChange={onProject}
              allowNone
              noneLabel="General pool (any project)"
            />
            <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>
              Pinning this node to a project restricts placement: only services from that project
              can schedule replicas here. Leave on general pool to share across all projects.
            </div>
          </div>

          {n.labels && n.labels.length > 0 && (
            <div>
              <div
                className="muted"
                style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}
              >
                Labels
              </div>
              <div className="row gap-2" style={{ flexWrap: "wrap" }}>
                {n.labels.map((l) => (
                  <span key={l} className="badge mono" style={{ background: "var(--bg-sunken)" }}>
                    {l}
                  </span>
                ))}
                <button className="btn ghost sm">+ add</button>
              </div>
            </div>
          )}
        </div>
        )}
      </div>
    </div>
  );
}

function ProjectTagBadgeReadOnly({ id }: { id: string }) {
  // Compact non-removable variant for table rows.
  const p = PROJECTS.find((x) => x.id === id);
  if (!p) return null;
  return (
    <span
      className="mono"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "0 5px",
        height: 14,
        fontSize: 9,
        borderRadius: 2,
        background: `color-mix(in srgb, ${p.color} 14%, transparent)`,
        color: p.color,
      }}
    >
      <span style={{ width: 4, height: 4, borderRadius: "50%", background: p.color }} />
      {p.name}
    </span>
  );
}

function KV({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="row" style={{ padding: "5px 0", fontSize: 12 }}>
      <span className="muted" style={{ width: 90, fontSize: 11 }}>
        {k}
      </span>
      <span className={mono ? "mono" : ""} style={{ flex: 1, color: "var(--fg-2)" }}>
        {v}
      </span>
    </div>
  );
}

function AddServerModal({ onClose, onAdd }: { onClose: () => void; onAdd: (n: Node) => void }) {
  const [name, setName] = useState("helio-prod-04");
  const [host, setHost] = useState("10.0.4.14");
  const [region, setRegion] = useState(REGIONS[0]?.id ?? "sfo");
  const [role, setRole] = useState<NodeRole>("worker");
  const [project, setProjectLocal] = useState<string | undefined>(undefined);
  const [copied, setCopied] = useState<"worker" | "manager" | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const token = role === "manager" ? SWARM_JOIN_TOKEN_MANAGER : SWARM_JOIN_TOKEN_WORKER;
  const cmd = `docker swarm join --token ${token} ${SWARM_MANAGER_ADDR}`;

  const copy = (which: "worker" | "manager") => {
    const t = which === "manager" ? SWARM_JOIN_TOKEN_MANAGER : SWARM_JOIN_TOKEN_WORKER;
    const c = `docker swarm join --token ${t} ${SWARM_MANAGER_ADDR}`;
    if (typeof navigator !== "undefined" && navigator.clipboard) navigator.clipboard.writeText(c);
    setCopied(which);
    setTimeout(() => setCopied(null), 1500);
  };

  const submit = () => {
    onAdd({
      id: `n_${Math.random().toString(36).slice(2, 8)}`,
      name,
      host,
      region,
      role,
      availability: "active",
      status: "ready",
      cpu: { used: 0, total: 16 },
      mem: { used: 0, total: 32 },
      disk: { used: 0, total: 500, unit: "GB" },
      services: 0,
      joined: "just now",
      daemonVersion: "26.1.4",
      labels: [],
      project,
    });
    onClose();
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 200,
        background: "rgba(0,0,0,0.4)",
        display: "grid",
        placeItems: "center",
        backdropFilter: "blur(2px)",
      }}
    >
      <div onClick={(e) => e.stopPropagation()} className="os-modal" style={{ width: 640 }}>
        <div className="row gap-2 os-modal-h">
          <I.server width={14} height={14} />
          <span style={{ fontWeight: 600 }}>Add server to swarm</span>
          <div style={{ flex: 1 }} />
          <button className="btn ghost icon sm" onClick={onClose}>
            <I.close width={13} height={13} />
          </button>
        </div>

        <div className="col gap-4" style={{ padding: 18, overflow: "auto", maxHeight: "70vh" }}>
          <div className="muted" style={{ fontSize: 12 }}>
            <b style={{ color: "var(--fg)" }}>1.</b> SSH into the new host, install Docker, then run the join
            command below. The node will register with the swarm manager at{" "}
            <span className="mono" style={{ color: "var(--fg-2)" }}>{SWARM_MANAGER_ADDR}</span>.
          </div>

          <div className="row gap-1" style={{ background: "var(--bg-sunken)", padding: 2, borderRadius: 6, border: "1px solid var(--border)", display: "inline-flex" }}>
            <Seg active={role === "worker"} onClick={() => setRole("worker")}>
              Worker
            </Seg>
            <Seg active={role === "manager"} onClick={() => setRole("manager")}>
              Manager
            </Seg>
          </div>

          <div
            className="card mono"
            style={{
              padding: "12px 14px",
              fontSize: 11.5,
              lineHeight: 1.6,
              wordBreak: "break-all",
              background: "var(--bg-sunken)",
              position: "relative",
            }}
          >
            {cmd}
            <button
              className="btn sm"
              style={{ position: "absolute", top: 8, right: 8 }}
              onClick={() => copy(role)}
            >
              <I.copy width={11} height={11} /> {copied === role ? "Copied" : "Copy"}
            </button>
          </div>

          <div style={{ height: 1, background: "var(--border)" }} />

          <div className="muted" style={{ fontSize: 12 }}>
            <b style={{ color: "var(--fg)" }}>2.</b> After the daemon reports back, fill in the metadata so
            it shows up in the right region and rotation.
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <Field label="Hostname">
              <input className="input mono" value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label="Private IP">
              <input className="input mono" value={host} onChange={(e) => setHost(e.target.value)} />
            </Field>
            <Field label="Region">
              <select
                className="input"
                value={region}
                onChange={(e) => setRegion(e.target.value)}
              >
                {REGIONS.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.flag} {r.name} ({r.id})
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Role">
              <select
                className="input"
                value={role}
                onChange={(e) => setRole(e.target.value as NodeRole)}
              >
                <option value="worker">worker</option>
                <option value="manager">manager (raft quorum)</option>
              </select>
            </Field>
          </div>

          <Field label="Pinned to project">
            <ProjectPicker
              value={project}
              onChange={setProjectLocal}
              allowNone
              noneLabel="General pool — any project can place tasks here"
            />
          </Field>
        </div>

        <div className="row gap-2" style={{ padding: 14, borderTop: "1px solid var(--border)" }}>
          <span className="muted" style={{ fontSize: 11 }}>
            Otterstack will retry SSH every 10s until the daemon answers.
          </span>
          <div style={{ flex: 1 }} />
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={submit} disabled={!name || !host}>
            <I.plus width={11} height={11} /> Register node
          </button>
        </div>
      </div>
    </div>
  );
}

function Seg({ children, active, onClick }: { children: React.ReactNode; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: "4px 10px",
        fontSize: 11,
        borderRadius: 4,
        background: active ? "var(--bg-elev)" : "transparent",
        color: active ? "var(--fg)" : "var(--fg-3)",
        fontWeight: active ? 500 : 400,
        cursor: "pointer",
        boxShadow: active ? "var(--shadow-sm)" : "none",
        border: 0,
      }}
    >
      {children}
    </button>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="col gap-1">
      <label
        style={{ fontSize: 11, color: "var(--fg-3)", textTransform: "uppercase", letterSpacing: "0.06em" }}
      >
        {label}
      </label>
      {children}
    </div>
  );
}
