// Variation C — Dense ops console.
// Power-user view: graph at left as compact list, traffic table center,
// real-time activity feed on right. Information-dense, terminal energy.

import { useEffect, useMemo, useState } from "react";
import { I } from "../icons";
import { DEPLOYMENTS, EDGES, ENV_VARS, SERVICES } from "../data";
import type { Edge, Env, Service } from "../data";
import { StatusBadge } from "../components/status-badge";

type Props = {
  env: Env;
  onOpenLogs: (id: string) => void;
  onDeploy: () => void;
  onOpenService: (id: string) => void;
  onNewService: () => void;
};

export function OpsConsole({ onOpenLogs, onDeploy, onOpenService }: Props) {
  const [tick, setTick] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1500);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const openSvc = SERVICES.find((s) => s.id === openId);

  return (
    <div
      style={{
        flex: 1,
        display: "grid",
        gridTemplateColumns: "300px 1fr 360px",
        overflow: "hidden",
        position: "relative",
      }}
    >
      {/* LEFT: service rail */}
      <div
        style={{ borderRight: "1px solid var(--border)", overflow: "auto", padding: "10px 0" }}
        className="os-scroll"
      >
        <div
          className="muted"
          style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", padding: "4px 14px" }}
        >
          Compute
        </div>
        {SERVICES.filter((s) => s.kind === "service").map((s) => (
          <RailRow
            key={s.id}
            s={s}
            tick={tick}
            active={openId === s.id}
            onClick={() => setOpenId(openId === s.id ? null : s.id)}
          />
        ))}
        <div
          className="muted"
          style={{
            fontSize: 10,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            padding: "12px 14px 4px",
          }}
        >
          Stateful
        </div>
        {SERVICES.filter((s) => s.kind === "database").map((s) => (
          <RailRow
            key={s.id}
            s={s}
            tick={tick}
            active={openId === s.id}
            onClick={() => setOpenId(openId === s.id ? null : s.id)}
          />
        ))}
      </div>

      <RailDetail
        svc={openSvc}
        onClose={() => setOpenId(null)}
        onOpenLogs={onOpenLogs}
        onDeploy={onDeploy}
        onOpenService={onOpenService}
      />

      {/* CENTER: graph + traffic table */}
      <div style={{ display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {/* compact topology */}
        <div
          style={{
            height: 280,
            position: "relative",
            borderBottom: "1px solid var(--border)",
            background: "var(--bg)",
            backgroundImage: "radial-gradient(circle at 1px 1px, var(--border) 1px, transparent 0)",
            backgroundSize: "16px 16px",
          }}
        >
          <div style={{ position: "absolute", top: 8, left: 12, fontSize: 11 }} className="muted">
            topology / 60s window
          </div>
          <svg
            viewBox="0 0 880 260"
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
            preserveAspectRatio="xMidYMid meet"
          >
            <defs>
              <marker id="arrow3" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto">
                <path d="M0,0 L8,4 L0,8 z" fill="var(--fg-3)" />
              </marker>
            </defs>
            {EDGES.map((e, i) => {
              const a = SERVICES.find((s) => s.id === e.from)!;
              const b = SERVICES.find((s) => s.id === e.to)!;
              const ax = a.pos.x * 0.85 + 50;
              const ay = a.pos.y * 0.4 + 30;
              const bx = b.pos.x * 0.85;
              const by = b.pos.y * 0.4 + 30;
              const cx = (ax + bx) / 2;
              const path = `M ${ax} ${ay} C ${cx} ${ay}, ${cx} ${by}, ${bx} ${by}`;
              return (
                <g key={i}>
                  <path
                    d={path}
                    fill="none"
                    stroke="var(--border-strong)"
                    strokeWidth="1"
                    markerEnd="url(#arrow3)"
                    opacity="0.7"
                  />
                  <circle r="2" fill="var(--fg-2)">
                    <animateMotion dur={`${0.6 + (i % 5) * 0.4}s`} repeatCount="indefinite" path={path} />
                  </circle>
                </g>
              );
            })}
            {SERVICES.map((n) => (
              <g key={n.id} transform={`translate(${n.pos.x * 0.85}, ${n.pos.y * 0.4})`}>
                <rect width="50" height="60" rx="6" fill="var(--bg-elev)" stroke="var(--border)" strokeWidth="1" />
                <rect
                  x="0"
                  y="0"
                  width="2"
                  height="60"
                  rx="1"
                  fill={
                    n.status === "healthy"
                      ? "var(--ok)"
                      : n.status === "degraded"
                        ? "var(--warn)"
                        : "var(--err)"
                  }
                />
                <text
                  x="25"
                  y="22"
                  fontFamily="var(--font-mono)"
                  fontSize="10"
                  fontWeight="500"
                  fill="var(--fg)"
                  textAnchor="middle"
                >
                  {n.name}
                </text>
                <text
                  x="25"
                  y="36"
                  fontFamily="var(--font-mono)"
                  fontSize="9"
                  fill="var(--fg-3)"
                  textAnchor="middle"
                >
                  {Math.round(n.cpu * 100)}%
                </text>
                <rect x="6" y="44" width="38" height="2" rx="1" fill="var(--bg-overlay)" />
                <rect x="6" y="44" width={Math.round(38 * n.cpu)} height="2" rx="1" fill="var(--fg-3)" />
              </g>
            ))}
          </svg>
        </div>

        {/* edges table */}
        <div style={{ flex: 1, overflow: "auto" }} className="os-scroll">
          <div
            className="row"
            style={{
              padding: "8px 14px",
              borderBottom: "1px solid var(--border)",
              fontSize: 10,
              color: "var(--fg-3)",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              background: "var(--bg-sunken)",
            }}
          >
            <span style={{ width: 130 }}>From</span>
            <span style={{ width: 16 }} />
            <span style={{ width: 130 }}>To</span>
            <span style={{ width: 80 }}>Kind</span>
            <span style={{ flex: 1 }}>Throughput (60s)</span>
            <span style={{ width: 80, textAlign: "right" }}>RPS</span>
            <span style={{ width: 80, textAlign: "right" }}>P95</span>
            <span style={{ width: 80, textAlign: "right" }}>Errors</span>
          </div>
          {EDGES.map((e, i) => (
            <EdgeRow key={i} e={e} idx={i} tick={tick} />
          ))}
        </div>
      </div>

      {/* RIGHT: activity feed */}
      <div
        style={{
          borderLeft: "1px solid var(--border)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <div className="row gap-2" style={{ padding: "10px 14px", borderBottom: "1px solid var(--border)" }}>
          <span style={{ fontWeight: 500, fontSize: 13 }}>Activity</span>
          <span className="badge live ok" style={{ marginLeft: "auto" }}>
            <span className="dot" />
            live
          </span>
        </div>
        <div className="os-scroll" style={{ flex: 1, overflow: "auto", padding: 8 }}>
          <ActivityFeed tick={tick} />
        </div>
        <div style={{ padding: 10, borderTop: "1px solid var(--border)" }}>
          <button className="btn primary" style={{ width: "100%" }} onClick={onDeploy}>
            <I.rocket width={12} height={12} /> Deploy
          </button>
        </div>
      </div>
    </div>
  );
}

type RailRowProps = {
  s: Service;
  tick: number;
  active: boolean;
  onClick: () => void;
};

function RailRow({ s, tick, active, onClick }: RailRowProps) {
  const dot = s.status === "healthy" ? "var(--ok)" : s.status === "degraded" ? "var(--warn)" : "var(--err)";
  // wobble cpu slightly
  const cpu = Math.max(0, Math.min(1, s.cpu + Math.sin(tick + s.name.length) * 0.04));
  const [hover, setHover] = useState(false);
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        padding: "8px 14px",
        display: "grid",
        gridTemplateColumns: "8px 1fr auto",
        columnGap: 8,
        alignItems: "center",
        borderBottom: "1px solid var(--border)",
        background: active ? "var(--bg-overlay)" : hover ? "var(--bg-overlay)" : "transparent",
        borderLeft: `2px solid ${active ? "var(--fg)" : "transparent"}`,
        marginLeft: active ? -2 : 0,
        cursor: "pointer",
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: dot }} />
      <div style={{ minWidth: 0 }}>
        <div className="row gap-2">
          <span className="mono" style={{ fontSize: 12, fontWeight: 500 }}>
            {s.name}
          </span>
          <span className="mono" style={{ fontSize: 10, color: "var(--fg-4)" }}>
            ×{s.replicas}
          </span>
        </div>
        <div className="row gap-2" style={{ marginTop: 3 }}>
          <span className="mono" style={{ fontSize: 10, color: "var(--fg-3)", width: 30 }}>
            {Math.round(cpu * 100)}%
          </span>
          <div style={{ flex: 1, height: 2, background: "var(--bg-overlay)", borderRadius: 1 }}>
            <div
              style={{
                width: `${cpu * 100}%`,
                height: "100%",
                background: cpu > 0.7 ? "var(--warn)" : "var(--fg-3)",
                transition: "width 1s",
              }}
            />
          </div>
        </div>
      </div>
      <I.chev
        width={11}
        height={11}
        style={{
          color: "var(--fg-4)",
          transform: active ? "rotate(90deg)" : "none",
          transition: "transform 120ms",
        }}
      />
    </div>
  );
}

type RailDetailProps = {
  svc: Service | undefined;
  onClose: () => void;
  onOpenLogs: (id: string) => void;
  onDeploy: () => void;
  onOpenService: (id: string) => void;
};

function RailDetail({ svc, onClose, onOpenLogs, onDeploy, onOpenService }: RailDetailProps) {
  // Compute hooks BEFORE early return so hook order stays stable.
  const spark = useMemo(() => {
    if (!svc) return [];
    const pts: number[] = [];
    let s = svc.name.length + 3;
    const rng = () => {
      s = (s * 9301 + 49297) % 233280;
      return s / 233280;
    };
    for (let i = 0; i < 60; i++) pts.push(50 + (rng() - 0.5) * 60);
    return pts;
  }, [svc]);

  if (!svc) return null;
  const isDB = svc.kind === "database";
  const envs = ENV_VARS[svc.id] || [];
  const deps = DEPLOYMENTS.filter((d) => d.service === svc.id);
  const sparkPath = spark.map((v, i) => `${i === 0 ? "M" : "L"} ${i * 5} ${48 - v * 0.4}`).join(" ");

  return (
    <div
      onClick={onClose}
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 50,
        background: "rgba(0,0,0,0.32)",
        animation: "rdFade 140ms ease-out",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          left: 300,
          width: 460,
          background: "var(--bg-elev)",
          borderRight: "1px solid var(--border)",
          boxShadow: "var(--shadow-lg)",
          display: "flex",
          flexDirection: "column",
          animation: "rdSlide 180ms cubic-bezier(.2,.8,.2,1)",
          overflow: "hidden",
        }}
      >
        <style>{`@keyframes rdFade { from { opacity: 0 } to { opacity: 1 } } @keyframes rdSlide { from { transform: translateX(-12px); opacity: 0 } to { transform: none; opacity: 1 } }`}</style>

        <div style={{ padding: 16, borderBottom: "1px solid var(--border)" }}>
          <div className="row gap-2">
            {isDB ? <I.db width={16} height={16} /> : <I.service width={16} height={16} />}
            <span className="mono" style={{ fontSize: 16, fontWeight: 600 }}>
              {svc.name}
            </span>
            <StatusBadge status={svc.status} />
            <div style={{ flex: 1 }} />
            <button className="btn ghost icon sm" onClick={onClose} title="Close (esc)">
              <I.close width={12} height={12} />
            </button>
          </div>
          <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
            {isDB
              ? `${svc.image} · port ${svc.port}`
              : `${svc.framework} · ${svc.replicas} replica${svc.replicas > 1 ? "s" : ""} · ${svc.image}`}
          </div>
          <div className="row gap-2" style={{ marginTop: 12 }}>
            <button className="btn primary sm" onClick={() => onOpenService && onOpenService(svc.id)}>
              Open<I.chev width={10} height={10} />
            </button>
            {!isDB && (
              <button className="btn sm" onClick={onDeploy}>
                <I.rocket width={11} height={11} /> Deploy
              </button>
            )}
            <button className="btn sm" onClick={() => onOpenLogs && onOpenLogs(svc.id)}>
              <I.log width={11} height={11} /> Tail logs
            </button>
            {isDB && <button className="btn sm">Console</button>}
            <button className="btn ghost icon sm">
              <I.more width={12} height={12} />
            </button>
          </div>
        </div>

        <div className="os-scroll" style={{ flex: 1, overflow: "auto", padding: 16 }}>
          {/* Live metrics */}
          <div
            className="muted"
            style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}
          >
            Live · 1m
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginBottom: 16 }}>
            <MiniStat label="cpu" value={`${Math.round(svc.cpu * 100)}%`} pct={svc.cpu} />
            <MiniStat label="mem" value={`${Math.round(svc.mem * 100)}%`} pct={svc.mem} />
            <MiniStat
              label={isDB ? "qps" : "rps"}
              value={isDB ? (svc.id === "redis" ? "980" : "312") : "184"}
            />
          </div>
          <div className="card" style={{ padding: 10, marginBottom: 16 }}>
            <div className="row" style={{ marginBottom: 4 }}>
              <span className="muted" style={{ fontSize: 11 }}>
                request rate
              </span>
              <div style={{ flex: 1 }} />
              <span className="mono" style={{ fontSize: 11, color: "var(--fg-2)" }}>
                last 5m
              </span>
            </div>
            <svg
              viewBox="0 0 300 50"
              style={{ width: "100%", height: 50, display: "block" }}
              preserveAspectRatio="none"
            >
              <path d={sparkPath} fill="none" stroke="var(--fg)" strokeWidth="1.2" />
            </svg>
          </div>

          {/* Connection */}
          <div
            className="muted"
            style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}
          >
            Connection
          </div>
          <div className="card" style={{ padding: 10, marginBottom: 16 }}>
            <KVMini k="internal" v={`${svc.name}.helio.internal${svc.port ? ":" + svc.port : ""}`} />
            {svc.domain && <KVMini k="public" v={`https://${svc.domain}`} />}
            {svc.repo && <KVMini k="repo" v={`${svc.repo}@${svc.branch || "main"}`} />}
            {svc.commit && <KVMini k="commit" v={`${svc.commit} · ${svc.lastDeploy || ""}`} />}
          </div>

          {/* Recent deploys */}
          {!isDB && deps.length > 0 && (
            <>
              <div
                className="muted"
                style={{
                  fontSize: 10,
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  marginBottom: 8,
                }}
              >
                Recent deploys
              </div>
              <div className="card" style={{ overflow: "hidden", marginBottom: 16 }}>
                {deps.slice(0, 4).map((d, i) => (
                  <div
                    key={d.id}
                    className="row gap-2"
                    style={{
                      padding: "8px 10px",
                      borderTop: i === 0 ? "none" : "1px solid var(--border)",
                      fontSize: 12,
                    }}
                  >
                    <StatusBadge status={d.status} />
                    <span className="mono" style={{ color: "var(--fg-2)" }}>
                      {d.commit}
                    </span>
                    <span
                      style={{
                        flex: 1,
                        minWidth: 0,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {d.msg}
                    </span>
                    <span className="muted" style={{ fontSize: 11 }}>
                      {d.when}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* Env */}
          {envs.length > 0 && (
            <>
              <div className="row" style={{ marginBottom: 8 }}>
                <span
                  className="muted"
                  style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em" }}
                >
                  Variables
                </span>
                <div style={{ flex: 1 }} />
                <span className="muted" style={{ fontSize: 11 }}>
                  {envs.length}
                </span>
              </div>
              <div className="card" style={{ overflow: "hidden" }}>
                {envs.slice(0, 5).map((v, i) => (
                  <div
                    key={v.k}
                    className="row gap-2"
                    style={{
                      padding: "6px 10px",
                      borderTop: i === 0 ? "none" : "1px solid var(--border)",
                      fontSize: 11,
                    }}
                  >
                    <span
                      className="mono"
                      style={{
                        fontWeight: 500,
                        width: 140,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {v.k}
                    </span>
                    <span
                      className="mono"
                      style={{
                        color: "var(--fg-3)",
                        flex: 1,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {v.secret ? v.v.replace(/[^•@:/.\-]/g, "•") : v.v}
                    </span>
                  </div>
                ))}
                {envs.length > 5 && (
                  <div
                    style={{
                      padding: "6px 10px",
                      borderTop: "1px solid var(--border)",
                      fontSize: 11,
                      color: "var(--fg-3)",
                      textAlign: "center",
                    }}
                  >
                    +{envs.length - 5} more
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function MiniStat({ label, value, pct }: { label: string; value: string; pct?: number }) {
  return (
    <div className="card" style={{ padding: 10 }}>
      <div className="muted" style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em" }}>
        {label}
      </div>
      <div className="mono" style={{ fontSize: 16, fontWeight: 600, marginTop: 2 }}>
        {value}
      </div>
      {pct != null && (
        <div style={{ height: 2, background: "var(--bg-overlay)", borderRadius: 1, marginTop: 6 }}>
          <div
            style={{
              width: `${pct * 100}%`,
              height: "100%",
              background: pct > 0.7 ? "var(--warn)" : "var(--fg-2)",
            }}
          />
        </div>
      )}
    </div>
  );
}

function KVMini({ k, v }: { k: string; v: string }) {
  return (
    <div className="row gap-2" style={{ padding: "4px 0", fontSize: 12 }}>
      <span className="muted" style={{ width: 70, fontSize: 11 }}>
        {k}
      </span>
      <span
        className="mono"
        style={{ flex: 1, fontSize: 11, color: "var(--fg-2)", wordBreak: "break-all" }}
      >
        {v}
      </span>
      <button className="btn ghost icon sm" style={{ width: 20, height: 20 }}>
        <I.copy width={10} height={10} />
      </button>
    </div>
  );
}

function Spark({ idx }: { idx: number }) {
  // Deterministic seedable LCG so sparklines stay stable across re-renders
  const sparkPath = useMemo(() => {
    const pts: number[] = [];
    let s = idx + 1;
    const rng = () => {
      s = (s * 9301 + 49297) % 233280;
      return s / 233280;
    };
    for (let i = 0; i < 30; i++) pts.push(50 + (rng() - 0.5) * 80);
    return pts.map((v, i) => `${i === 0 ? "M" : "L"} ${i * 4} ${20 - v * 0.18}`).join(" ");
  }, [idx]);
  return (
    <svg width="120" height="20" preserveAspectRatio="none" viewBox="0 0 120 20">
      <path d={sparkPath} fill="none" stroke="var(--fg-2)" strokeWidth="1" />
    </svg>
  );
}

export function EdgeRow({ e, idx, tick }: { e: Edge; idx: number; tick: number }) {
  const rps = Math.round(e.rps + Math.sin(tick + idx) * Math.min(20, e.rps * 0.1));
  const errPct = (Math.abs(Math.sin(tick * 0.7 + idx * 1.3)) * 0.4).toFixed(2);
  return (
    <div
      className="row"
      style={{ padding: "7px 14px", borderBottom: "1px solid var(--border)", fontSize: 12 }}
    >
      <span className="mono" style={{ width: 130, color: "var(--fg-2)" }}>
        {e.from}
      </span>
      <span className="mono" style={{ width: 16, color: "var(--fg-4)" }}>
        →
      </span>
      <span className="mono" style={{ width: 130, color: "var(--fg-2)" }}>
        {e.to}
      </span>
      <span className="mono" style={{ width: 80, color: "var(--fg-3)", fontSize: 11 }}>
        {e.kind}
      </span>
      <span style={{ flex: 1, paddingRight: 12 }}>
        <Spark idx={idx} />
      </span>
      <span className="mono" style={{ width: 80, textAlign: "right" }}>
        {rps}
      </span>
      <span className="mono" style={{ width: 80, textAlign: "right", color: "var(--fg-3)" }}>
        {Math.round(40 + (idx + 1) * 12)}ms
      </span>
      <span
        className="mono"
        style={{
          width: 80,
          textAlign: "right",
          color: parseFloat(errPct) > 0.2 ? "var(--warn)" : "var(--fg-3)",
        }}
      >
        {errPct}%
      </span>
    </div>
  );
}

type ActivityKind = "deploy" | "health" | "log" | "env" | "scale";
type ActivityItem = {
  kind: ActivityKind;
  svc: string;
  msg: string;
  author: string;
  id: number | string;
  when: string;
  isNew?: boolean;
};

const ACTIVITY_TEMPLATES: Array<Omit<ActivityItem, "id" | "when">> = [
  { kind: "deploy", svc: "api", msg: "shipped 3f9b042", author: "arjun" },
  { kind: "health", svc: "worker", msg: "cpu > 70% on replica 2", author: "system" },
  { kind: "log", svc: "api", msg: "GET /v1/charges 201 184ms", author: "system" },
  { kind: "env", svc: "web", msg: "NEXT_PUBLIC_FEATURE_BANNER updated", author: "mira" },
  { kind: "scale", svc: "api", msg: "scaled up: 3 → 4 replicas", author: "autoscaler" },
  { kind: "log", svc: "web", msg: "ISR revalidated /pricing", author: "system" },
  { kind: "deploy", svc: "web", msg: "shipped 8a2c1f9", author: "mira" },
  { kind: "health", svc: "postgres", msg: "backup completed (18s)", author: "system" },
];

export function ActivityFeed({ tick }: { tick: number }) {
  const [items, setItems] = useState<ActivityItem[]>(() =>
    Array.from({ length: 12 }, (_, i) => ({
      ...ACTIVITY_TEMPLATES[i % ACTIVITY_TEMPLATES.length],
      id: i,
      when: `${i + 1}m`,
    })),
  );
  useEffect(() => {
    const t = ACTIVITY_TEMPLATES[Math.floor(Math.random() * ACTIVITY_TEMPLATES.length)];
    setItems((p) => [{ ...t, id: Math.random(), when: "now", isNew: true }, ...p.slice(0, 24)]);
  }, [tick]);

  const dot = (k: ActivityKind) =>
    k === "deploy"
      ? "var(--info)"
      : k === "health"
        ? "var(--warn)"
        : k === "scale"
          ? "var(--ok)"
          : "var(--fg-4)";
  return (
    <div className="col" style={{ gap: 1 }}>
      {items.map((a, i) => (
        <div
          key={a.id}
          className="row gap-2"
          style={{
            padding: "7px 8px",
            borderRadius: 4,
            fontSize: 12,
            background: a.isNew && i === 0 ? "var(--bg-overlay)" : "transparent",
            transition: "background 800ms",
          }}
        >
          <span
            style={{
              width: 5,
              height: 5,
              borderRadius: "50%",
              background: dot(a.kind),
              marginTop: 6,
              flex: "none",
            }}
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="row gap-2">
              <span className="mono" style={{ fontWeight: 500 }}>
                {a.svc}
              </span>
              <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {a.msg}
              </span>
            </div>
            <div style={{ fontSize: 11, color: "var(--fg-4)" }}>
              {a.author} · {a.when}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
