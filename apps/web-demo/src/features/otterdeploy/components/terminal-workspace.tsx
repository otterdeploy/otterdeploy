// Multi-tab terminal workspace. Holds N independent shell / ssh / psql / redis
// sessions, each one a tab at the top. New tabs via the "+" picker.

import { useEffect, useMemo, useState } from "react";

import { DatabaseLogo } from "@/components/brand/database-logo";
import { I } from "../icons";
import { NODES, PROJECTS, SERVICES } from "../data";
import { Terminal, type TerminalKind, type TerminalTarget } from "./terminal";
import {
  ALL_PROJECTS,
  ProjectFilterStrip,
  ProjectTagBadge,
  matchesProjectFilter,
} from "./project-filter";

export interface TerminalSession {
  id: string;
  kind: TerminalKind;
  /** Tab label. */
  title: string;
  /** Optional sub-label rendered next to the dot (e.g. "web · r2"). */
  subtitle?: string;
  /** Project tags this session inherits from its source resource. Used for the tab dot + filter. */
  projectTags?: string[];
  target: TerminalTarget;
}

interface Props {
  /** Pre-seeded sessions (auto-active = first). */
  initial?: TerminalSession[];
  /** Hide the "Terminal" page-level header (used when the workspace is itself a sub-pane). */
  embedded?: boolean;
}

export function TerminalWorkspace({ initial = [], embedded = false }: Props) {
  const [sessions, setSessions] = useState<TerminalSession[]>(initial);
  const [activeId, setActiveId] = useState<string | null>(
    initial[0]?.id ?? null,
  );
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    // If we have no active id but sessions exist, activate the first.
    if (sessions.length > 0 && !sessions.find((s) => s.id === activeId)) {
      setActiveId(sessions[0]!.id);
    }
  }, [sessions, activeId]);

  const open = (s: TerminalSession) => {
    setSessions((prev) => {
      // de-dupe by id
      if (prev.find((p) => p.id === s.id)) return prev;
      return [...prev, s];
    });
    setActiveId(s.id);
  };

  const close = (id: string) => {
    setSessions((prev) => {
      const next = prev.filter((s) => s.id !== id);
      if (activeId === id) {
        const idx = prev.findIndex((s) => s.id === id);
        const fallback = next[Math.min(idx, next.length - 1)];
        setActiveId(fallback ? fallback.id : null);
      }
      return next;
    });
  };

  const active = sessions.find((s) => s.id === activeId) ?? null;

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        background: "var(--bg)",
      }}
    >
      {!embedded && (
        <div
          className="row"
          style={{
            padding: "12px 18px",
            borderBottom: "1px solid var(--border)",
            background: "var(--bg-elev)",
          }}
        >
          <span style={{ fontSize: 14, fontWeight: 600 }}>Terminal</span>
          <span className="muted" style={{ fontSize: 12, marginLeft: 10 }}>
            interactive sessions across services, databases, and swarm nodes
          </span>
          <div style={{ flex: 1 }} />
          <span className="muted mono" style={{ fontSize: 11 }}>
            {sessions.length} {sessions.length === 1 ? "session" : "sessions"}
          </span>
        </div>
      )}

      {/* tab strip */}
      <div
        className="row"
        style={{
          borderBottom: "1px solid var(--border)",
          background: "var(--bg-elev)",
          height: 36,
          flexShrink: 0,
          overflow: "hidden",
        }}
      >
        <div
          className="row"
          style={{ flex: 1, minWidth: 0, overflow: "auto", height: "100%" }}
        >
          {sessions.map((s) => (
            <SessionTab
              key={s.id}
              s={s}
              active={activeId === s.id}
              onActivate={() => setActiveId(s.id)}
              onClose={() => close(s.id)}
            />
          ))}
        </div>
        <button
          className="btn ghost sm"
          style={{ height: 24, margin: "0 6px", flexShrink: 0 }}
          onClick={() => setPickerOpen(true)}
        >
          <I.plus width={11} height={11} /> New session
        </button>
      </div>

      {/* active terminal */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          padding: 12,
          display: "flex",
        }}
      >
        {active ? (
          // Use key to remount Terminal when active session changes,
          // so each session gets its own fresh transcript state.
          <Terminal key={active.id} kind={active.kind} target={active.target} />
        ) : (
          <EmptyState onPick={() => setPickerOpen(true)} />
        )}
      </div>

      {pickerOpen && (
        <SessionPicker
          onClose={() => setPickerOpen(false)}
          onPick={(s) => {
            open(s);
            setPickerOpen(false);
          }}
        />
      )}
    </div>
  );
}

function SessionTab({
  s,
  active,
  onActivate,
  onClose,
}: {
  s: TerminalSession;
  active: boolean;
  onActivate: () => void;
  onClose: () => void;
}) {
  const firstTag = s.projectTags?.[0];
  const project = firstTag
    ? PROJECTS.find((p) => p.id === firstTag)
    : undefined;
  return (
    <div
      onClick={onActivate}
      className="row gap-2"
      style={{
        height: "100%",
        padding: "0 8px 0 12px",
        fontSize: 12,
        cursor: "pointer",
        background: active ? "var(--bg)" : "transparent",
        color: active ? "var(--fg)" : "var(--fg-3)",
        borderRight: "1px solid var(--border)",
        position: "relative",
        flexShrink: 0,
        maxWidth: 280,
      }}
    >
      <KindGlyph kind={s.kind} />
      <span
        className="mono"
        style={{
          fontWeight: active ? 500 : 400,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {s.title}
      </span>
      {s.subtitle && (
        <span className="muted mono" style={{ fontSize: 10 }}>
          {s.subtitle}
        </span>
      )}
      {project && (
        <span
          title={`tagged · ${project.name}`}
          style={{
            width: 5,
            height: 5,
            borderRadius: "50%",
            background: project.color,
          }}
        />
      )}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        className="btn ghost icon sm"
        style={{ width: 18, height: 18, marginLeft: 2 }}
        title="Close session"
      >
        <I.close width={10} height={10} />
      </button>
      {active && (
        <span
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: -1,
            height: 2,
            background: "var(--fg)",
          }}
        />
      )}
    </div>
  );
}

function KindGlyph({ kind }: { kind: TerminalKind }) {
  const m: Record<TerminalKind, { color: string; label: string }> = {
    shell: { color: "var(--info)", label: "sh" },
    ssh: { color: "var(--warn)", label: "ssh" },
    psql: { color: "var(--ok)", label: "pg" },
    redis: { color: "var(--err)", label: "rd" },
  };
  const { color, label } = m[kind];
  return (
    <span
      className="mono"
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        minWidth: 22,
        height: 16,
        padding: "0 4px",
        borderRadius: 3,
        background: "var(--bg-overlay)",
        color,
        fontSize: 9,
        fontWeight: 600,
        letterSpacing: "0.05em",
        textTransform: "uppercase",
      }}
    >
      {label}
    </span>
  );
}

function EmptyState({ onPick }: { onPick: () => void }) {
  return (
    <div
      style={{
        flex: 1,
        display: "grid",
        placeItems: "center",
        border: "1px dashed var(--border)",
        borderRadius: 8,
        background: "var(--bg)",
      }}
    >
      <div
        className="col gap-3"
        style={{ alignItems: "center", textAlign: "center", padding: 32 }}
      >
        <span className="mono" style={{ fontSize: 48, color: "var(--fg-4)" }}>
          $_
        </span>
        <div style={{ fontSize: 14, fontWeight: 500 }}>No active sessions</div>
        <div className="muted" style={{ fontSize: 12, maxWidth: 380 }}>
          Open a shell into any container, an SSH into a swarm node, or a
          database console. Multiple sessions can stay live as separate tabs.
        </div>
        <button className="btn primary" onClick={onPick}>
          <I.plus width={12} height={12} /> Open a terminal
        </button>
      </div>
    </div>
  );
}

// ───────── Picker ─────────

type PickerKind = "container" | "ssh" | "db";

function SessionPicker({
  onClose,
  onPick,
}: {
  onClose: () => void;
  onPick: (s: TerminalSession) => void;
}) {
  const [kind, setKind] = useState<PickerKind>("container");
  const [filter, setFilter] = useState<string>(ALL_PROJECTS);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Counts across all three pickable kinds, so the strip stays steady regardless of the active tab.
  const counts = useMemo(() => {
    const out: Record<string, number> = {};
    for (const p of PROJECTS) {
      const services = SERVICES.filter(
        (s) => s.kind === "service" && s.project === p.id,
      ).length;
      const dbs = SERVICES.filter(
        (s) => s.kind === "database" && s.project === p.id,
      ).length;
      const nodes = NODES.filter(
        (n) => !n.project || n.project === p.id,
      ).length;
      out[p.id] = services + dbs + nodes;
    }
    return out;
  }, []);

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
        className="os-modal"
        style={{ width: 580 }}
      >
        <div className="row gap-2 os-modal-h">
          <I.bolt width={14} height={14} />
          <span style={{ fontWeight: 600 }}>Open a terminal</span>
          <div style={{ flex: 1 }} />
          <button className="btn ghost icon sm" onClick={onClose}>
            <I.close width={13} height={13} />
          </button>
        </div>

        <div style={{ padding: 14, borderBottom: "1px solid var(--border)" }}>
          <div className="row gap-2" style={{ flexWrap: "wrap" }}>
            <div
              className="row gap-1"
              style={{
                background: "var(--bg-sunken)",
                padding: 2,
                borderRadius: 6,
                border: "1px solid var(--border)",
                display: "inline-flex",
              }}
            >
              <Seg
                active={kind === "container"}
                onClick={() => setKind("container")}
              >
                Container
              </Seg>
              <Seg active={kind === "ssh"} onClick={() => setKind("ssh")}>
                SSH (node)
              </Seg>
              <Seg active={kind === "db"} onClick={() => setKind("db")}>
                Database
              </Seg>
            </div>
            <div style={{ flex: 1 }} />
            <ProjectFilterStrip
              active={filter}
              onChange={setFilter}
              counts={counts}
            />
          </div>
          <div className="muted" style={{ fontSize: 11, marginTop: 8 }}>
            {kind === "container"
              ? "Pick a service then a specific container (replica) to docker exec into."
              : kind === "ssh"
                ? "SSH as root into a swarm node."
                : "Open psql / redis-cli against a database primary."}
          </div>
        </div>

        <div
          style={{ padding: 6, maxHeight: 380, overflow: "auto" }}
          className="os-scroll"
        >
          {kind === "container" && (
            <ContainerList filter={filter} onPick={onPick} />
          )}
          {kind === "ssh" && <SshList filter={filter} onPick={onPick} />}
          {kind === "db" && <DbList filter={filter} onPick={onPick} />}
        </div>
      </div>
    </div>
  );
}

function Seg({
  children,
  active,
  onClick,
}: {
  children: React.ReactNode;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: "4px 12px",
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

function ContainerList({
  filter,
  onPick,
}: {
  filter: string;
  onPick: (s: TerminalSession) => void;
}) {
  const services = useMemo(
    () =>
      SERVICES.filter(
        (s) =>
          s.kind === "service" &&
          matchesProjectFilter(filter, s.project ? [s.project] : []),
      ),
    [filter],
  );
  if (services.length === 0)
    return <EmptyPickerRow text="No services match this filter." />;
  return (
    <div className="col gap-1" style={{ padding: 4 }}>
      {services.map((s) => (
        <ContainerGroup
          key={s.id}
          name={s.name}
          replicas={s.replicas || 1}
          tags={s.project ? [s.project] : []}
          onPick={(replicaId, replicaName) =>
            onPick({
              id: `shell:${s.id}:${replicaId}`,
              kind: "shell",
              title: s.name,
              subtitle: replicaName,
              projectTags: s.project ? [s.project] : undefined,
              target: shellTarget(s.name, replicaId, replicaName),
            })
          }
        />
      ))}
    </div>
  );
}

function ContainerGroup({
  name,
  replicas,
  tags,
  onPick,
}: {
  name: string;
  replicas: number;
  tags: string[];
  onPick: (replicaId: string, replicaName: string) => void;
}) {
  return (
    <div className="card" style={{ padding: 8 }}>
      <div className="row gap-2" style={{ marginBottom: 6, flexWrap: "wrap" }}>
        <I.service width={12} height={12} style={{ color: "var(--fg-3)" }} />
        <span className="mono" style={{ fontWeight: 500, fontSize: 12 }}>
          {name}
        </span>
        <span className="muted" style={{ fontSize: 11 }}>
          · {replicas} {replicas === 1 ? "container" : "containers"}
        </span>
        {tags.map((id) => (
          <ProjectTagBadge key={id} id={id} />
        ))}
      </div>
      <div className="row gap-1" style={{ flexWrap: "wrap" }}>
        {Array.from({ length: replicas }, (_, i) => {
          const replicaName = `r${i + 1}`;
          const replicaId = `r${i + 1}`;
          return (
            <button
              key={replicaId}
              className="btn sm"
              onClick={() => onPick(replicaId, replicaName)}
              style={{ fontFamily: "var(--font-mono)" }}
            >
              <I.bolt width={10} height={10} /> {replicaName}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SshList({
  filter,
  onPick,
}: {
  filter: string;
  onPick: (s: TerminalSession) => void;
}) {
  const nodes = useMemo(
    () =>
      NODES.filter((n) =>
        matchesProjectFilter(filter, n.project ? [n.project] : []),
      ),
    [filter],
  );
  if (nodes.length === 0)
    return <EmptyPickerRow text="No nodes match this filter." />;
  return (
    <div className="col gap-1" style={{ padding: 4 }}>
      {nodes.map((n) => (
        <button
          key={n.id}
          className="row gap-3"
          onClick={() =>
            onPick({
              id: `ssh:${n.id}`,
              kind: "ssh",
              title: n.name,
              subtitle: n.host,
              projectTags: n.project ? [n.project] : undefined,
              target: sshTarget(n.name, n.host),
            })
          }
          style={{
            width: "100%",
            padding: "8px 10px",
            borderRadius: 5,
            cursor: "pointer",
            textAlign: "left",
            border: 0,
            background: "transparent",
          }}
          onMouseEnter={(e) =>
            (e.currentTarget.style.background = "var(--bg-overlay)")
          }
          onMouseLeave={(e) =>
            (e.currentTarget.style.background = "transparent")
          }
        >
          <I.server width={13} height={13} style={{ color: "var(--fg-3)" }} />
          <span className="mono" style={{ fontSize: 12, fontWeight: 500 }}>
            {n.name}
          </span>
          <span className="muted mono" style={{ fontSize: 11 }}>
            {n.host}
          </span>
          <div
            style={{
              flex: 1,
              display: "flex",
              justifyContent: "flex-end",
              flexWrap: "wrap",
              gap: 4,
            }}
          >
            {n.project ? (
              <ProjectTagBadge id={n.project} />
            ) : (
              <span className="muted" style={{ fontSize: 10 }}>
                general pool
              </span>
            )}
          </div>
          <span className="muted mono" style={{ fontSize: 10, marginLeft: 8 }}>
            {n.role}
          </span>
        </button>
      ))}
    </div>
  );
}

function DbList({
  filter,
  onPick,
}: {
  filter: string;
  onPick: (s: TerminalSession) => void;
}) {
  const dbs = useMemo(
    () =>
      SERVICES.filter(
        (s) =>
          s.kind === "database" &&
          matchesProjectFilter(filter, s.project ? [s.project] : []),
      ),
    [filter],
  );
  if (dbs.length === 0)
    return <EmptyPickerRow text="No databases match this filter." />;
  return (
    <div className="col gap-1" style={{ padding: 4 }}>
      {dbs.map((db) => {
        const kind: TerminalKind = db.image.startsWith("postgres")
          ? "psql"
          : "redis";
        return (
          <button
            key={db.id}
            className="row gap-3"
            onClick={() =>
              onPick({
                id: `${kind}:${db.id}`,
                kind,
                title: db.name,
                subtitle: kind,
                projectTags: db.project ? [db.project] : undefined,
                target: dbTarget(db.name, kind),
              })
            }
            style={{
              width: "100%",
              padding: "8px 10px",
              borderRadius: 5,
              cursor: "pointer",
              textAlign: "left",
              border: 0,
              background: "transparent",
            }}
            onMouseEnter={(e) =>
              (e.currentTarget.style.background = "var(--bg-overlay)")
            }
            onMouseLeave={(e) =>
              (e.currentTarget.style.background = "transparent")
            }
          >
            <DatabaseLogo
              value={`${db.name} ${db.image}`}
              size={13}
              color="var(--fg-3)"
            />
            <span className="mono" style={{ fontSize: 12, fontWeight: 500 }}>
              {db.name}
            </span>
            <span className="muted mono" style={{ fontSize: 11 }}>
              {db.image}
            </span>
            <div
              style={{
                flex: 1,
                display: "flex",
                justifyContent: "flex-end",
                flexWrap: "wrap",
                gap: 4,
              }}
            >
              {db.project && <ProjectTagBadge id={db.project} />}
            </div>
            <span
              className="muted mono"
              style={{ fontSize: 10, marginLeft: 8 }}
            >
              {kind}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function EmptyPickerRow({ text }: { text: string }) {
  return (
    <div
      style={{
        padding: 18,
        textAlign: "center",
        color: "var(--fg-3)",
        fontSize: 12,
      }}
    >
      {text}
    </div>
  );
}

// ───────── Target builders ─────────

export function shellTarget(
  serviceName: string,
  replicaId: string,
  replicaName: string,
): TerminalTarget {
  return {
    label: `${serviceName} · ${replicaName}`,
    prompt: `app@${serviceName}-${replicaId}:/usr/src/app$`,
    banner: [
      `[otterdeploy] connecting to ${serviceName} · container ${replicaId}…`,
      `[otterdeploy] docker exec -it ${serviceName}.${replicaId}.task /bin/sh`,
      `[otterdeploy] connected. type 'help' for demo commands.`,
      ``,
    ],
  };
}

export function sshTarget(nodeName: string, host: string): TerminalTarget {
  return {
    label: `${nodeName} · ${host}`,
    prompt: `root@${nodeName}:~#`,
    banner: [
      `[otterdeploy] SSH to root@${host} (port 22)…`,
      `[otterdeploy] using ed25519 deploy key`,
      `Linux ${nodeName} 6.6.16 #1 SMP x86_64 GNU/Linux`,
      ``,
    ],
  };
}

export function dbTarget(
  dbName: string,
  kind: "psql" | "redis",
): TerminalTarget {
  if (kind === "psql") {
    return {
      label: `${dbName} · psql`,
      prompt: "helio=#",
      banner: [
        "psql (16.2 (Debian 16.2-1.pgdg120+1))",
        `Type "help" for help.`,
        "",
      ],
    };
  }
  return {
    label: `${dbName} · redis-cli`,
    prompt: `${dbName}:6379>`,
    banner: [
      `Connected to redis at ${dbName}.helio.internal:6379`,
      `redis-cli 7.2.4 — type "help" or PING.`,
      "",
    ],
  };
}
