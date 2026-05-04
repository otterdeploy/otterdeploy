// Variation A — Service Graph (the hero view).
// A canvas-based dependency graph with traffic visualization.
// Click a node to drawer it open. Edges animate with traffic.

import { useState } from "react";
import { I } from "../icons";
import { DEPLOYMENTS, EDGES, ENV_VARS, SERVICES } from "../data";
import type { Env, Service } from "../data";
import { StatusBadge } from "../components/status-badge";

type Props = {
  env: Env;
  onOpenLogs: (id: string) => void;
  onDeploy: () => void;
  onOpenService: (id: string) => void;
  onNewService: () => void;
};

export function ServiceGraph({ onOpenLogs, onDeploy, onOpenService }: Props) {
  const [selected, setSelected] = useState<string>("api");
  const [hover, setHover] = useState<string | null>(null);

  const W = 880;
  const H = 560;
  const nodes = SERVICES.map((s) => ({ ...s }));
  const nodeById: Record<string, Service> = Object.fromEntries(nodes.map((n) => [n.id, n]));

  return (
    <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
      <div
        style={{
          flex: 1,
          position: "relative",
          overflow: "hidden",
          background: "var(--bg)",
          backgroundImage: "radial-gradient(circle at 1px 1px, var(--border) 1px, transparent 0)",
          backgroundSize: "20px 20px",
        }}
      >
        {/* Top toolbar */}
        <div
          style={{
            position: "absolute",
            top: 12,
            left: 12,
            right: 12,
            display: "flex",
            alignItems: "center",
            gap: 8,
            zIndex: 10,
          }}
        >
          <div className="card row gap-2" style={{ padding: "4px 6px" }}>
            <button className="btn ghost sm">Layout</button>
            <span style={{ width: 1, height: 14, background: "var(--border)" }} />
            <button className="btn ghost sm">Fit</button>
            <button className="btn ghost sm">100%</button>
          </div>
          <div style={{ flex: 1 }} />
          <div className="card row gap-2" style={{ padding: "4px 8px", fontSize: 11 }}>
            <span className="muted">traffic</span>
            <span className="mono" style={{ color: "var(--fg)" }}>1.2k rps</span>
            <span style={{ width: 1, height: 12, background: "var(--border)" }} />
            <span className="muted">p95</span>
            <span className="mono" style={{ color: "var(--fg)" }}>112ms</span>
          </div>
        </div>

        <svg
          viewBox={`0 0 ${W} ${H}`}
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
          preserveAspectRatio="xMidYMid meet"
        >
          <defs>
            <marker id="arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto">
              <path d="M0,0 L8,4 L0,8 z" fill="var(--fg-3)" />
            </marker>
          </defs>

          {/* Edges */}
          {EDGES.map((e, i) => {
            const a = nodeById[e.from];
            const b = nodeById[e.to];
            const ax = a.pos.x + 60;
            const ay = a.pos.y + 30;
            const bx = b.pos.x;
            const by = b.pos.y + 30;
            const isFromHover =
              hover === e.from || hover === e.to || selected === e.from || selected === e.to;
            const stroke = isFromHover ? "var(--fg)" : "var(--border-strong)";
            const strokeW = Math.max(1, Math.min(3, Math.log10(e.rps + 1) * 0.9));
            const cx = (ax + bx) / 2;
            const path = `M ${ax} ${ay} C ${cx} ${ay}, ${cx} ${by}, ${bx} ${by}`;
            return (
              <g key={i}>
                <path
                  d={path}
                  fill="none"
                  stroke={stroke}
                  strokeWidth={strokeW}
                  markerEnd="url(#arrow)"
                  opacity={isFromHover ? 1 : 0.55}
                />
                {isFromHover && (
                  <circle r="3" fill="var(--fg)">
                    <animateMotion dur={`${1.2 + Math.random()}s`} repeatCount="indefinite" path={path} />
                  </circle>
                )}
                {isFromHover && (
                  <text
                    x={cx}
                    y={(ay + by) / 2 - 6}
                    fontSize="10"
                    fontFamily="var(--font-mono)"
                    fill="var(--fg-2)"
                    textAnchor="middle"
                  >
                    {e.rps} rps · {e.kind}
                  </text>
                )}
              </g>
            );
          })}

          {/* Nodes */}
          {nodes.map((n) => (
            <GraphNode
              key={n.id}
              n={n}
              selected={selected === n.id}
              onSelect={() => setSelected(n.id)}
              onHover={setHover}
            />
          ))}
        </svg>

        {/* Legend */}
        <div
          style={{
            position: "absolute",
            bottom: 12,
            left: 12,
            display: "flex",
            gap: 8,
            zIndex: 10,
            flexDirection: "column",
          }}
        >
          <div className="card row gap-3" style={{ padding: "8px 12px", fontSize: 11 }}>
            <div className="row gap-2">
              <svg width="14" height="2">
                <rect width="14" height="2" fill="var(--border-strong)" />
              </svg>
              <span className="muted">edge = dependency</span>
            </div>
            <div className="row gap-2">
              <svg width="14" height="2">
                <rect width="14" height="2.5" fill="var(--fg)" />
              </svg>
              <span className="muted">live traffic</span>
            </div>
            <div className="row gap-2">
              <span style={{ width: 8, height: 8, borderRadius: 50, background: "var(--ok)" }} />
              <span className="muted">healthy</span>
            </div>
            <div className="row gap-2">
              <span style={{ width: 8, height: 8, borderRadius: 50, background: "var(--warn)" }} />
              <span className="muted">degraded</span>
            </div>
          </div>
        </div>
      </div>

      {/* Right drawer */}
      <ServiceDrawer
        service={nodeById[selected]}
        onOpenLogs={onOpenLogs}
        onOpenService={onOpenService}
        onDeploy={onDeploy}
      />
    </div>
  );
}

type GraphNodeProps = {
  n: Service;
  selected: boolean;
  onSelect: () => void;
  onHover: (id: string | null) => void;
};

function GraphNode({ n, selected, onSelect, onHover }: GraphNodeProps) {
  const w = 120;
  const h = 60;
  const dot = n.status === "healthy" ? "var(--ok)" : n.status === "degraded" ? "var(--warn)" : "var(--err)";
  return (
    <g
      transform={`translate(${n.pos.x}, ${n.pos.y})`}
      onClick={onSelect}
      onMouseEnter={() => onHover(n.id)}
      onMouseLeave={() => onHover(null)}
      style={{ cursor: "pointer" }}
    >
      <rect
        width={w}
        height={h}
        rx="8"
        fill="var(--bg-elev)"
        stroke={selected ? "var(--fg)" : "var(--border)"}
        strokeWidth={selected ? 1.5 : 1}
        filter={selected ? "drop-shadow(0 4px 12px rgba(0,0,0,0.08))" : ""}
      />
      {/* status indicator stripe */}
      <rect x="0" y="0" width="3" height={h} rx="1.5" fill={dot} />

      {/* type icon */}
      <g
        transform="translate(12, 12)"
        fill="none"
        stroke="var(--fg-3)"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {n.kind === "database" ? (
          <g>
            <ellipse cx="6" cy="2.5" rx="5" ry="1.5" />
            <path d="M1 2.5v6c0 .8 2.2 1.5 5 1.5s5-.7 5-1.5v-6" />
            <path d="M1 5.5c0 .8 2.2 1.5 5 1.5s5-.7 5-1.5" />
          </g>
        ) : (
          <g>
            <rect x="0.5" y="0.5" width="11" height="3.5" rx="0.8" />
            <rect x="0.5" y="6.5" width="11" height="3.5" rx="0.8" />
          </g>
        )}
      </g>

      {/* name */}
      <text x="32" y="22" fontFamily="var(--font-mono)" fontSize="13" fontWeight="500" fill="var(--fg)">
        {n.name}
      </text>

      {/* meta */}
      <text x="32" y="38" fontFamily="var(--font-sans)" fontSize="10.5" fill="var(--fg-3)">
        {n.kind === "database" ? `${n.version || ""}` : `${n.replicas} replica${n.replicas > 1 ? "s" : ""}`}
      </text>

      {/* CPU bar */}
      <rect x="32" y="46" width="76" height="2" rx="1" fill="var(--bg-overlay)" />
      <rect
        x="32"
        y="46"
        width={Math.round(76 * n.cpu)}
        height="2"
        rx="1"
        fill={n.cpu > 0.7 ? "var(--warn)" : "var(--fg-3)"}
      />
    </g>
  );
}

type ServiceDrawerProps = {
  service: Service | undefined;
  onOpenLogs: (id: string) => void;
  onDeploy: () => void;
  onOpenService: (id: string) => void;
};

function ServiceDrawer({ service, onOpenLogs, onDeploy, onOpenService }: ServiceDrawerProps) {
  const [tab, setTab] = useState<"overview" | "deploys" | "env">("overview");
  if (!service) return null;
  const isDB = service.kind === "database";

  return (
    <aside
      style={{
        width: 380,
        borderLeft: "1px solid var(--border)",
        background: "var(--bg-elev)",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div style={{ padding: 16, borderBottom: "1px solid var(--border)" }}>
        <div className="row gap-2">
          {isDB ? <I.db width={16} height={16} /> : <I.service width={16} height={16} />}
          <span className="mono" style={{ fontSize: 16, fontWeight: 600 }}>
            {service.name}
          </span>
          <div style={{ flex: 1 }} />
          <StatusBadge status={service.status} />
        </div>
        <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
          {isDB
            ? `${service.image} · port ${service.port}`
            : `${service.framework} · ${service.replicas} replicas`}
        </div>

        <div className="row gap-2" style={{ marginTop: 12 }}>
          <button className="btn primary sm" onClick={() => onOpenService && onOpenService(service.id)}>
            Open<I.chev width={10} height={10} />
          </button>
          {!isDB && (
            <button className="btn sm" onClick={onDeploy}>
              <I.rocket width={11} height={11} /> Deploy
            </button>
          )}
          <button className="btn sm" onClick={() => onOpenLogs(service.id)}>
            <I.log width={11} height={11} /> Logs
          </button>
          <button className="btn ghost icon sm">
            <I.more width={12} height={12} />
          </button>
        </div>
      </div>

      {!isDB && (
        <div className="row gap-1" style={{ padding: "8px 12px", borderBottom: "1px solid var(--border)" }}>
          {(["overview", "deploys", "env"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                padding: "4px 10px",
                borderRadius: 4,
                fontSize: 12,
                background: tab === t ? "var(--bg-overlay)" : "transparent",
                color: tab === t ? "var(--fg)" : "var(--fg-3)",
                fontWeight: tab === t ? 500 : 400,
                cursor: "pointer",
                textTransform: "capitalize",
              }}
            >
              {t}
            </button>
          ))}
        </div>
      )}

      <div className="os-scroll" style={{ flex: 1, overflow: "auto", padding: 16 }}>
        {(tab === "overview" || isDB) && (
          <div className="col gap-4">
            <KV k="Repo" v={service.repo || service.image} />
            {service.branch && <KV k="Branch" v={service.branch} mono />}
            {service.domain && <KV k="Domain" v={service.domain} mono />}
            {service.port && <KV k="Port" v={String(service.port)} mono />}
            {service.image && !isDB && <KV k="Image" v={service.image} mono />}

            <div style={{ height: 1, background: "var(--border)" }} />

            <div>
              <div
                className="muted"
                style={{
                  fontSize: 11,
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  marginBottom: 10,
                }}
              >
                Resources
              </div>
              <Bar label="cpu" v={service.cpu} />
              <div style={{ height: 8 }} />
              <Bar label="memory" v={service.mem} />
              {service.storage && (
                <>
                  <div style={{ height: 8 }} />
                  <Bar label="storage" v={service.storage.used / service.storage.total} />
                </>
              )}
            </div>

            {service.commitMsg && (
              <>
                <div style={{ height: 1, background: "var(--border)" }} />
                <div>
                  <div
                    className="muted"
                    style={{
                      fontSize: 11,
                      textTransform: "uppercase",
                      letterSpacing: "0.06em",
                      marginBottom: 8,
                    }}
                  >
                    Latest deploy
                  </div>
                  <div className="row gap-2">
                    <span className="mono" style={{ fontSize: 12, color: "var(--fg-2)" }}>
                      {service.commit}
                    </span>
                    <span className="muted" style={{ fontSize: 11 }}>
                      {service.lastDeploy}
                    </span>
                  </div>
                  <div style={{ fontSize: 13, marginTop: 4 }}>{service.commitMsg}</div>
                  <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                    by {service.author}
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {tab === "deploys" && !isDB && (
          <div className="col" style={{ gap: 6 }}>
            {DEPLOYMENTS.filter((d) => d.service === service.id).map((d) => (
              <div
                key={d.id}
                style={{
                  padding: "10px 12px",
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                }}
              >
                <div className="row gap-2">
                  <StatusBadge status={d.status} />
                  <span className="mono" style={{ fontSize: 12, color: "var(--fg-2)" }}>
                    {d.commit}
                  </span>
                  <div style={{ flex: 1 }} />
                  <span className="muted" style={{ fontSize: 11 }}>
                    {d.when}
                  </span>
                </div>
                <div style={{ fontSize: 13, marginTop: 4 }}>{d.msg}</div>
              </div>
            ))}
          </div>
        )}

        {tab === "env" && !isDB && (
          <div className="col gap-1">
            {(ENV_VARS[service.id] || []).map((v) => (
              <div
                key={v.k}
                className="row gap-2"
                style={{ padding: "6px 0", borderBottom: "1px solid var(--border)" }}
              >
                <span
                  className="mono"
                  style={{
                    fontSize: 12,
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
                    fontSize: 12,
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
          </div>
        )}
      </div>
    </aside>
  );
}

function KV({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="row" style={{ alignItems: "flex-start" }}>
      <span className="muted" style={{ fontSize: 12, width: 90, flex: "none" }}>
        {k}
      </span>
      <span
        className={mono ? "mono" : ""}
        style={{ fontSize: 12, color: "var(--fg)", flex: 1, wordBreak: "break-all" }}
      >
        {v}
      </span>
    </div>
  );
}

function Bar({ label, v }: { label: string; v: number }) {
  const pct = Math.max(0, Math.min(1, v));
  return (
    <div>
      <div className="row" style={{ marginBottom: 4 }}>
        <span className="muted" style={{ fontSize: 11 }}>
          {label}
        </span>
        <div style={{ flex: 1 }} />
        <span className="mono" style={{ fontSize: 11, color: "var(--fg-2)" }}>
          {Math.round(pct * 100)}%
        </span>
      </div>
      <div style={{ height: 4, background: "var(--bg-overlay)", borderRadius: 2 }}>
        <div
          style={{
            width: `${pct * 100}%`,
            height: "100%",
            background: pct > 0.7 ? "var(--warn)" : "var(--fg-2)",
            borderRadius: 2,
          }}
        />
      </div>
    </div>
  );
}
