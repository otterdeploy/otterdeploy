// Volumes — persistent storage backed by host disks or attached block storage.
// Single-owner project model (one project per volume), filtered with the shared
// ProjectFilterStrip.

import { useMemo, useState } from "react";

import { I } from "../icons";
import { PROJECTS } from "../data";
import { Field, SectionH, Switch3 } from "../components/form";
import {
  ALL_PROJECTS,
  ProjectFilterStrip,
  ProjectTagBadge,
  matchesProjectFilter,
} from "../components/project-filter";

type VolumeDriver = "local-ssd" | "local-hdd" | "nvme" | "network-nfs";
type VolumeStatus = "attached" | "detached" | "snapshotting" | "resizing";
type Encryption = "AES-256" | "none";

interface Volume {
  id: string;
  name: string;
  driver: VolumeDriver;
  sizeGb: number;
  usedGb: number;
  mountPath: string;
  attachedTo: { service: string; replicas: number } | null;
  encryption: Encryption;
  lastSnapshot: string;
  project: string;
  status: VolumeStatus;
}

const SEED: Volume[] = [
  {
    id: "vol_pg",
    name: "postgres-data",
    driver: "local-ssd",
    sizeGb: 50,
    usedGb: 12.4,
    mountPath: "/var/lib/postgresql/data",
    attachedTo: { service: "postgres", replicas: 1 },
    encryption: "AES-256",
    lastSnapshot: "1h ago",
    project: "helio",
    status: "attached",
  },
  {
    id: "vol_redis",
    name: "redis-data",
    driver: "local-ssd",
    sizeGb: 1,
    usedGb: 0.12,
    mountPath: "/data",
    attachedTo: { service: "redis", replicas: 1 },
    encryption: "none",
    lastSnapshot: "6h ago",
    project: "helio",
    status: "attached",
  },
  {
    id: "vol_uploads",
    name: "web-uploads",
    driver: "network-nfs",
    sizeGb: 200,
    usedGb: 87.2,
    mountPath: "/app/uploads",
    attachedTo: { service: "web", replicas: 3 },
    encryption: "AES-256",
    lastSnapshot: "12h ago",
    project: "helio",
    status: "attached",
  },
  {
    id: "vol_tmp",
    name: "worker-tmp",
    driver: "local-hdd",
    sizeGb: 20,
    usedGb: 4.1,
    mountPath: "/tmp/work",
    attachedTo: { service: "worker", replicas: 2 },
    encryption: "none",
    lastSnapshot: "—",
    project: "helio",
    status: "attached",
  },
  {
    id: "vol_billing_pg",
    name: "billing-pg-data",
    driver: "nvme",
    sizeGb: 100,
    usedGb: 31.8,
    mountPath: "/var/lib/postgresql/data",
    attachedTo: { service: "billing-pg", replicas: 1 },
    encryption: "AES-256",
    lastSnapshot: "2h ago",
    project: "billing",
    status: "snapshotting",
  },
  {
    id: "vol_marketing_static",
    name: "marketing-static",
    driver: "network-nfs",
    sizeGb: 10,
    usedGb: 0,
    mountPath: "/srv/static",
    attachedTo: null,
    encryption: "none",
    lastSnapshot: "—",
    project: "marketing",
    status: "detached",
  },
];

const DRIVER_META: Record<VolumeDriver, { label: string; sub: string; color: string }> = {
  "local-ssd": { label: "local-ssd", sub: "host SSD partition", color: "#34d399" },
  "local-hdd": { label: "local-hdd", sub: "host HDD partition", color: "#a3a3a3" },
  nvme: { label: "nvme", sub: "low-latency NVMe", color: "#f472b6" },
  "network-nfs": { label: "network-nfs", sub: "shared across nodes", color: "#60a5fa" },
};

export function Volumes() {
  const [volumes, setVolumes] = useState<Volume[]>(SEED);
  const [filter, setFilter] = useState<string>(ALL_PROJECTS);
  const [createOpen, setCreateOpen] = useState(false);

  const counts = useMemo(() => {
    const out: Record<string, number> = {};
    for (const p of PROJECTS) out[p.id] = volumes.filter((v) => v.project === p.id).length;
    return out;
  }, [volumes]);

  const filtered = useMemo(
    () =>
      volumes.filter((v) =>
        matchesProjectFilter(filter, [v.project].filter(Boolean) as string[]),
      ),
    [volumes, filter],
  );

  const stats = useMemo(() => {
    const total = filtered.length;
    const provisioned = filtered.reduce((s, v) => s + v.sizeGb, 0);
    const used = filtered.reduce((s, v) => s + v.usedGb, 0);
    const free = provisioned - used;
    return { total, provisioned, used, free };
  }, [filtered]);

  const addVolume = (v: Volume) => setVolumes((vs) => [...vs, v]);
  const removeVolume = (id: string) => setVolumes((vs) => vs.filter((v) => v.id !== id));

  return (
    <div className="os-scroll" style={{ flex: 1, overflow: "auto", padding: 24 }}>
      <div style={{ maxWidth: 1280, margin: "0 auto" }}>
        <div className="row" style={{ marginBottom: 16 }}>
          <SectionH
            title="Volumes"
            sub="Persistent storage backed by host disks or attached block storage."
          />
          <div style={{ flex: 1 }} />
          <button className="btn primary" onClick={() => setCreateOpen(true)}>
            <I.plus width={13} height={13} /> Create volume
          </button>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            gap: 12,
            marginBottom: 20,
          }}
        >
          <Stat label="Total volumes" value={`${stats.total}`} sub="across this filter" />
          <Stat
            label="Provisioned"
            value={`${stats.provisioned.toFixed(0)} GB`}
            sub="sum of declared sizes"
          />
          <Stat
            label="Used"
            value={`${stats.used.toFixed(1)} GB`}
            sub={`${stats.provisioned > 0 ? Math.round((stats.used / stats.provisioned) * 100) : 0}% of provisioned`}
          />
          <Stat label="Free" value={`${stats.free.toFixed(1)} GB`} sub="headroom remaining" />
        </div>

        <div className="row" style={{ marginBottom: 14 }}>
          <ProjectFilterStrip active={filter} onChange={setFilter} counts={counts} />
          <div style={{ flex: 1 }} />
          <span className="muted mono" style={{ fontSize: 11 }}>
            {filtered.length} / {volumes.length} volumes
          </span>
        </div>

        <div className="card" style={{ overflow: "hidden" }}>
          <div className="os-pe-head" style={{ padding: "10px 14px" }}>
            <span style={{ flex: 1.4 }}>Name</span>
            <span style={{ width: 130 }}>Driver</span>
            <span style={{ flex: 1.4 }}>Size · usage</span>
            <span style={{ flex: 1.2 }}>Mount path</span>
            <span style={{ flex: 1 }}>Attached to</span>
            <span style={{ width: 110 }}>Encryption</span>
            <span style={{ width: 110 }}>Backups</span>
            <span style={{ width: 110 }}>Project</span>
            <span style={{ width: 100 }}>Status</span>
            <span style={{ width: 28 }} />
          </div>
          {filtered.length === 0 && (
            <div style={{ padding: 24, textAlign: "center", color: "var(--fg-3)", fontSize: 12 }}>
              No volumes match this filter.
            </div>
          )}
          {filtered.map((v, i) => (
            <VolumeRow
              key={v.id}
              v={v}
              borderTop={i > 0}
              onDelete={() => removeVolume(v.id)}
            />
          ))}
        </div>

        <div className="muted" style={{ fontSize: 11, marginTop: 10 }}>
          Volumes are bound to a single project and follow that project&apos;s backup retention policy.
        </div>
      </div>

      {createOpen && (
        <CreateVolumeModal
          onClose={() => setCreateOpen(false)}
          onCreate={(v) => {
            addVolume(v);
            setCreateOpen(false);
          }}
        />
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

function VolumeStatusBadge({ status }: { status: VolumeStatus }) {
  if (status === "attached") return <span className="badge ok"><span className="dot" />attached</span>;
  if (status === "detached") return <span className="badge"><span className="dot" />detached</span>;
  if (status === "snapshotting") return <span className="badge info"><span className="dot" />snapshot</span>;
  return <span className="badge warn"><span className="dot" />resizing</span>;
}

function UsageBar({ used, total }: { used: number; total: number }) {
  const pct = total > 0 ? Math.min(100, (used / total) * 100) : 0;
  const color = pct > 85 ? "var(--err)" : pct > 65 ? "var(--warn)" : "var(--fg)";
  return (
    <div className="col gap-1" style={{ alignItems: "stretch" }}>
      <div className="row" style={{ fontSize: 11 }}>
        <span className="mono" style={{ color: "var(--fg)" }}>
          {used.toFixed(used < 10 ? 2 : 1)} / {total} GB
        </span>
        <div style={{ flex: 1 }} />
        <span className="muted mono" style={{ fontSize: 10 }}>{pct.toFixed(0)}%</span>
      </div>
      <div
        style={{
          height: 4,
          background: "var(--bg-sunken)",
          borderRadius: 2,
          overflow: "hidden",
        }}
      >
        <div style={{ height: "100%", width: `${pct}%`, background: color }} />
      </div>
    </div>
  );
}

function DriverPill({ driver }: { driver: VolumeDriver }) {
  const meta = DRIVER_META[driver];
  return (
    <span
      className="badge mono"
      style={{
        background: `color-mix(in srgb, ${meta.color} 14%, transparent)`,
        color: meta.color,
        borderColor: `color-mix(in srgb, ${meta.color} 28%, transparent)`,
        fontSize: 10,
      }}
    >
      <span style={{ width: 5, height: 5, borderRadius: "50%", background: meta.color }} />
      {meta.label}
    </span>
  );
}

function VolumeRow({
  v,
  borderTop,
  onDelete,
}: {
  v: Volume;
  borderTop: boolean;
  onDelete: () => void;
}) {
  return (
    <div
      className="row"
      style={{
        padding: "12px 14px",
        borderTop: borderTop ? "1px solid var(--border)" : "none",
        fontSize: 12,
        alignItems: "center",
      }}
    >
      <span style={{ flex: 1.4, display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
        <I.folder width={13} height={13} style={{ color: "var(--fg-3)" }} />
        <span className="col" style={{ gap: 2, alignItems: "flex-start", lineHeight: 1.2, minWidth: 0 }}>
          <span className="mono" style={{ fontWeight: 500 }}>{v.name}</span>
          <span className="muted" style={{ fontSize: 10 }}>{DRIVER_META[v.driver].sub}</span>
        </span>
      </span>
      <span style={{ width: 130 }}>
        <DriverPill driver={v.driver} />
      </span>
      <span style={{ flex: 1.4, paddingRight: 12 }}>
        <UsageBar used={v.usedGb} total={v.sizeGb} />
      </span>
      <span className="mono" style={{ flex: 1.2, color: "var(--fg-2)", fontSize: 11 }}>
        {v.mountPath}
      </span>
      <span style={{ flex: 1 }}>
        {v.attachedTo ? (
          <span className="row gap-2" style={{ alignItems: "center" }}>
            <I.service width={11} height={11} style={{ color: "var(--fg-3)" }} />
            <span className="mono" style={{ color: "var(--fg-2)" }}>{v.attachedTo.service}</span>
            <span className="muted mono" style={{ fontSize: 10 }}>×{v.attachedTo.replicas}</span>
          </span>
        ) : (
          <span className="muted">—</span>
        )}
      </span>
      <span style={{ width: 110 }}>
        {v.encryption === "AES-256" ? (
          <span className="row gap-2" style={{ alignItems: "center" }}>
            <I.lock width={11} height={11} style={{ color: "var(--ok)" }} />
            <span className="mono" style={{ fontSize: 11, color: "var(--fg-2)" }}>AES-256</span>
          </span>
        ) : (
          <span className="muted mono" style={{ fontSize: 11 }}>none</span>
        )}
      </span>
      <span style={{ width: 110 }}>
        <span className="muted mono" style={{ fontSize: 11 }}>{v.lastSnapshot}</span>
      </span>
      <span style={{ width: 110 }}>
        <ProjectTagBadge id={v.project} />
      </span>
      <span style={{ width: 100 }}>
        <VolumeStatusBadge status={v.status} />
      </span>
      <span style={{ width: 28, textAlign: "right" }}>
        <RowMenu onDelete={onDelete} />
      </span>
    </div>
  );
}

function RowMenu({ onDelete }: { onDelete: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <span style={{ position: "relative", display: "inline-block" }}>
      <button
        className="btn ghost icon sm"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
      >
        <I.more width={13} height={13} />
      </button>
      {open && (
        <>
          <div
            onClick={() => setOpen(false)}
            style={{ position: "fixed", inset: 0, zIndex: 90 }}
          />
          <div
            style={{
              position: "absolute",
              top: "100%",
              right: 0,
              marginTop: 4,
              background: "var(--bg-elev)",
              border: "1px solid var(--border)",
              borderRadius: 6,
              padding: 4,
              zIndex: 100,
              boxShadow: "var(--shadow-md)",
              minWidth: 160,
            }}
          >
            <MenuItem onClick={() => setOpen(false)} icon={I.refresh}>Snapshot now</MenuItem>
            <MenuItem onClick={() => setOpen(false)} icon={I.scale}>Resize…</MenuItem>
            <MenuItem onClick={() => setOpen(false)} icon={I.link}>Detach</MenuItem>
            <div style={{ height: 1, background: "var(--border)", margin: "4px 0" }} />
            <MenuItem
              onClick={() => {
                setOpen(false);
                onDelete();
              }}
              icon={I.trash}
              danger
            >
              Delete volume
            </MenuItem>
          </div>
        </>
      )}
    </span>
  );
}

function MenuItem({
  onClick,
  icon: Ic,
  danger,
  children,
}: {
  onClick: () => void;
  icon: (typeof I)[keyof typeof I];
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        width: "100%",
        padding: "6px 8px",
        background: "transparent",
        border: 0,
        fontSize: 12,
        cursor: "pointer",
        borderRadius: 4,
        color: danger ? "var(--err)" : "var(--fg-2)",
        textAlign: "left",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-overlay)")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      <Ic width={11} height={11} />
      <span>{children}</span>
    </button>
  );
}

const SNAPSHOT_PRESETS = [
  { id: "off", label: "Off", sub: "no automatic snapshots" },
  { id: "hourly", label: "Hourly · 24 retained", sub: "for hot databases" },
  { id: "daily", label: "Daily · 14 retained", sub: "default" },
  { id: "weekly", label: "Weekly · 8 retained", sub: "for static volumes" },
];

function CreateVolumeModal({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (v: Volume) => void;
}) {
  const [name, setName] = useState("");
  const [driver, setDriver] = useState<VolumeDriver>("local-ssd");
  const [sizeGb, setSizeGb] = useState(20);
  const [mountPath, setMountPath] = useState("/data");
  const [encrypted, setEncrypted] = useState(true);
  const [snapshot, setSnapshot] = useState("daily");
  const [project, setProject] = useState<string>(PROJECTS[0]?.id ?? "");

  const submit = () => {
    onCreate({
      id: "vol_" + Math.random().toString(36).slice(2, 8),
      name: name || "new-volume",
      driver,
      sizeGb,
      usedGb: 0,
      mountPath,
      attachedTo: null,
      encryption: encrypted ? "AES-256" : "none",
      lastSnapshot: snapshot === "off" ? "—" : "scheduled",
      project,
      status: "detached",
    });
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
      <div onClick={(e) => e.stopPropagation()} className="os-modal" style={{ width: 600 }}>
        <div className="row gap-2 os-modal-h">
          <I.plus width={14} height={14} />
          <span style={{ fontWeight: 600 }}>Create volume</span>
          <div style={{ flex: 1 }} />
          <button className="btn ghost icon sm" onClick={onClose}>
            <I.close width={13} height={13} />
          </button>
        </div>
        <div className="col gap-3" style={{ padding: 18, overflow: "auto", maxHeight: "70vh" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <Field label="Volume name">
              <input
                className="input mono"
                placeholder="postgres-data"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
            <Field label="Project">
              <select
                className="input"
                value={project}
                onChange={(e) => setProject(e.target.value)}
              >
                {PROJECTS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <div>
            <div className="muted" style={{ fontSize: 11, marginBottom: 6 }}>
              Driver
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
              {(Object.keys(DRIVER_META) as VolumeDriver[]).map((d) => {
                const meta = DRIVER_META[d];
                const active = driver === d;
                return (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setDriver(d)}
                    style={{
                      padding: "10px 12px",
                      borderRadius: 6,
                      border: `1px solid ${active ? "var(--fg)" : "var(--border)"}`,
                      background: active ? "var(--bg-overlay)" : "transparent",
                      cursor: "pointer",
                      textAlign: "left",
                    }}
                  >
                    <div className="row gap-2" style={{ alignItems: "center" }}>
                      <span
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: "50%",
                          background: meta.color,
                        }}
                      />
                      <span className="mono" style={{ fontSize: 12, color: "var(--fg)" }}>
                        {meta.label}
                      </span>
                    </div>
                    <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
                      {meta.sub}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <Field label={`Size · ${sizeGb} GB`}>
            <input
              type="range"
              min={1}
              max={500}
              step={1}
              value={sizeGb}
              onChange={(e) => setSizeGb(parseInt(e.target.value, 10))}
              style={{ width: "100%" }}
            />
          </Field>

          <Field label="Mount path">
            <input
              className="input mono"
              value={mountPath}
              onChange={(e) => setMountPath(e.target.value)}
              placeholder="/data"
            />
          </Field>

          <div
            className="row gap-3"
            style={{
              padding: "10px 12px",
              border: "1px solid var(--border)",
              borderRadius: 6,
              alignItems: "center",
            }}
          >
            <I.lock width={13} height={13} style={{ color: "var(--fg-3)" }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, fontWeight: 500 }}>Encryption at rest</div>
              <div className="muted" style={{ fontSize: 11 }}>
                AES-256 with per-volume KMS data key
              </div>
            </div>
            <Switch3 on={encrypted} onChange={setEncrypted} />
          </div>

          <div>
            <div className="muted" style={{ fontSize: 11, marginBottom: 6 }}>
              Snapshot schedule
            </div>
            <div className="col gap-1">
              {SNAPSHOT_PRESETS.map((p) => {
                const active = snapshot === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setSnapshot(p.id)}
                    className="row gap-3"
                    style={{
                      padding: "8px 10px",
                      border: `1px solid ${active ? "var(--fg)" : "var(--border)"}`,
                      borderRadius: 6,
                      background: active ? "var(--bg-overlay)" : "transparent",
                      cursor: "pointer",
                      alignItems: "center",
                      textAlign: "left",
                    }}
                  >
                    <span
                      style={{
                        width: 12,
                        height: 12,
                        borderRadius: "50%",
                        border: `1.5px solid ${active ? "var(--fg)" : "var(--border-strong)"}`,
                        background: active ? "var(--fg)" : "transparent",
                      }}
                    />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 12, fontWeight: 500, color: "var(--fg)" }}>
                        {p.label}
                      </div>
                      <div className="muted" style={{ fontSize: 11 }}>{p.sub}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="row gap-2" style={{ padding: 14, borderTop: "1px solid var(--border)" }}>
          <span className="muted" style={{ fontSize: 11 }}>
            Volume will be created in the{" "}
            <span className="mono" style={{ color: "var(--fg-2)" }}>detached</span> state — attach it to a service to mount.
          </span>
          <div style={{ flex: 1 }} />
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={submit}>Create volume</button>
        </div>
      </div>
    </div>
  );
}
