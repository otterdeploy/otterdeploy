import { useEffect, useMemo, useState } from "react";

import { I } from "../icons";
import { PROJECTS, SERVICES, type Service } from "../data";
import { StatusBadge } from "../components/status-badge";
import { TerminalWorkspace, dbTarget } from "../components/terminal-workspace";
import type { TerminalKind } from "../components/terminal";
import {
  ALL_PROJECTS,
  ProjectFilterStrip,
  ProjectTagBadge,
  ProjectPicker,
  matchesProjectFilter,
} from "../components/project-filter";

export function Databases() {
  const allDbs = useMemo(() => SERVICES.filter((s) => s.kind === "database"), []);
  const [dbs, setDbs] = useState<Service[]>(allDbs);
  const [consoleDb, setConsoleDb] = useState<Service | null>(null);
  const [filter, setFilter] = useState<string>(ALL_PROJECTS);

  const counts = useMemo(() => {
    const out: Record<string, number> = {};
    for (const p of PROJECTS) out[p.id] = dbs.filter((d) => d.project === p.id).length;
    return out;
  }, [dbs]);

  const filtered = useMemo(
    () => dbs.filter((d) => matchesProjectFilter(filter, d.project ? [d.project] : [])),
    [dbs, filter],
  );

  const setProject = (id: string, project: string | undefined) =>
    setDbs((ds) => ds.map((d) => (d.id === id ? { ...d, project } : d)));
  return (
    <div className="os-scroll" style={{ flex: 1, overflow: "auto", padding: 24 }}>
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        <div className="row" style={{ marginBottom: 12 }}>
          <SectionH title="Databases" />
          <div style={{ flex: 1 }} />
          <button className="btn primary">
            <I.plus width={13} height={13} /> Add database
          </button>
        </div>
        <div className="row" style={{ marginBottom: 14 }}>
          <ProjectFilterStrip active={filter} onChange={setFilter} counts={counts} />
        </div>

        <div className="col gap-3">
          {filtered.length === 0 && (
            <div className="muted" style={{ fontSize: 12, padding: 18 }}>
              No databases match this filter.
            </div>
          )}
          {filtered.map((db) => (
            <DBCard
              key={db.id}
              db={db}
              onConsole={() => setConsoleDb(db)}
              onProject={(project) => setProject(db.id, project)}
            />
          ))}
        </div>
      </div>

      {consoleDb && <DBConsoleModal db={consoleDb} onClose={() => setConsoleDb(null)} />}
    </div>
  );
}

function DBConsoleModal({ db, onClose }: { db: Service; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const kind: TerminalKind = db.image.startsWith("postgres") ? "psql" : "redis";

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
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(1280px, 96vw)",
          height: "min(800px, 90vh)",
          background: "var(--bg-elev)",
          border: "1px solid var(--border)",
          borderRadius: 12,
          boxShadow: "var(--shadow-lg)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <div className="row gap-2" style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)" }}>
          <I.db width={14} height={14} />
          <span style={{ fontWeight: 600 }}>
            Console · <span className="mono">{db.name}</span>
          </span>
          <span className="muted" style={{ fontSize: 11 }}>
            press Esc to close
          </span>
          <div style={{ flex: 1 }} />
          <button className="btn ghost icon sm" onClick={onClose}>
            <I.close width={13} height={13} />
          </button>
        </div>
        <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
          <TerminalWorkspace
            key={db.id}
            embedded
            initial={[
              {
                id: `${kind}:${db.id}`,
                kind,
                title: db.name,
                subtitle: kind,
                projectTags: db.project ? [db.project] : undefined,
                target: dbTarget(db.name, kind),
              },
            ]}
          />
        </div>
      </div>
    </div>
  );
}

function SectionH({ title, sub }: { title: string; sub?: string }) {
  return (
    <div style={{ marginBottom: 10, display: "flex", alignItems: "baseline", gap: 10 }}>
      <h3 style={{ margin: 0, fontSize: 13, fontWeight: 600, letterSpacing: "0.01em" }}>{title}</h3>
      {sub && (
        <span className="muted" style={{ fontSize: 12 }}>
          {sub}
        </span>
      )}
    </div>
  );
}

function DBCard({
  db,
  onConsole,
  onProject,
}: {
  db: Service;
  onConsole: () => void;
  onProject: (project: string | undefined) => void;
}) {
  const storage = db.storage ?? { used: 0, total: 1, unit: "GB" };
  const used = (storage.used / storage.total) * 100;
  return (
    <div className="card" style={{ padding: 18 }}>
      <div className="row gap-3">
        <div
          style={{
            width: 36,
            height: 36,
            display: "grid",
            placeItems: "center",
            borderRadius: 8,
            background: "var(--bg-sunken)",
            border: "1px solid var(--border)",
          }}
        >
          <I.db width={16} height={16} />
        </div>
        <div style={{ minWidth: 0 }}>
          <div className="row gap-2" style={{ flexWrap: "wrap" }}>
            <span className="mono" style={{ fontWeight: 500, fontSize: 14 }}>
              {db.name}
            </span>
            <span className="badge mono">{db.version}</span>
            {db.project && <ProjectTagBadge id={db.project} />}
          </div>
          <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
            port {db.port} · 1 primary, 0 replicas
          </div>
        </div>
        <div style={{ flex: 1 }} />
        <StatusBadge status={db.status} />
      </div>

      <div
        className="row gap-3"
        style={{
          marginTop: 14,
          paddingTop: 12,
          borderTop: "1px solid var(--border)",
          fontSize: 12,
        }}
      >
        <span className="muted" style={{ fontSize: 11 }}>
          Project tags
        </span>
        <ProjectPicker
          value={db.project}
          onChange={onProject}
          allowNone
          noneLabel="Untagged — not visible in any project filter"
        />
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 16,
          marginTop: 18,
          paddingTop: 16,
          borderTop: "1px solid var(--border)",
        }}
      >
        <DBStat
          label="Storage"
          value={`${storage.used}${storage.unit}`}
          sub={`of ${storage.total}${storage.unit}`}
          pct={used}
        />
        <DBStat label="Connections" value={db.name === "postgres" ? "14" : "32"} sub="of 100" />
        <DBStat label="QPS" value={db.name === "postgres" ? "312" : "980"} sub="last 1m" />
        <DBStat label="Backups" value="ok" sub="last: 2h ago" />
      </div>

      <div className="row gap-2" style={{ marginTop: 16, paddingTop: 14, borderTop: "1px solid var(--border)" }}>
        <span className="muted" style={{ fontSize: 12 }}>
          Connect via private network:
        </span>
        <code
          className="mono"
          style={{
            fontSize: 12,
            color: "var(--fg-2)",
            background: "var(--bg-sunken)",
            padding: "2px 6px",
            borderRadius: 4,
          }}
        >
          {db.name === "postgres" ? "postgres" : "redis"}://{db.name}:{db.port}
        </code>
        <button className="btn ghost icon sm">
          <I.copy width={12} height={12} />
        </button>
        <div style={{ flex: 1 }} />
        <button className="btn sm" onClick={onConsole}>
          <I.bolt width={11} height={11} /> Console
        </button>
        <button className="btn sm">Backups</button>
        <button className="btn sm">Settings</button>
      </div>
    </div>
  );
}

function DBStat({ label, value, sub, pct }: { label: string; value: string; sub: string; pct?: number }) {
  return (
    <div>
      <div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em" }}>
        {label}
      </div>
      <div style={{ fontSize: 18, fontWeight: 600, marginTop: 2, fontFamily: "var(--font-mono)" }}>{value}</div>
      <div className="muted" style={{ fontSize: 11 }}>
        {sub}
      </div>
      {pct != null && (
        <div style={{ height: 3, background: "var(--bg-overlay)", borderRadius: 2, marginTop: 6 }}>
          <div style={{ width: `${pct}%`, height: "100%", background: "var(--fg-2)", borderRadius: 2 }} />
        </div>
      )}
    </div>
  );
}
