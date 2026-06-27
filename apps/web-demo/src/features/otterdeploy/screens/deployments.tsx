import { useState } from "react";

import type { Deployment } from "../data";

import { StatusBadge } from "../components/status-badge";
import { I } from "../icons";

export function Deployments({
  deployments,
  onRollback,
}: {
  deployments: Deployment[];
  onRollback: (d: Deployment) => void;
}) {
  return (
    <div className="os-scroll" style={{ flex: 1, overflow: "auto", padding: 24 }}>
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        <SectionH title="Deployments" sub={`${deployments.length} total · last 7d`} />
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
            }}
          >
            <span style={{ width: 90 }}>Status</span>
            <span style={{ width: 90 }}>Service</span>
            <span style={{ flex: 1 }}>Commit</span>
            <span style={{ width: 80 }}>Author</span>
            <span style={{ width: 80, textAlign: "right" }}>Duration</span>
            <span style={{ width: 80, textAlign: "right" }}>When</span>
            <span style={{ width: 36 }} />
          </div>
          {deployments.map((d, i) => (
            <DeployRow
              key={d.id}
              d={d}
              canRollback={i === 0 || (d.status === "live" && i < 3)}
              onRollback={onRollback}
            />
          ))}
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

function DeployRow({
  d,
  canRollback,
  onRollback,
}: {
  d: Deployment;
  canRollback: boolean;
  onRollback: (d: Deployment) => void;
}) {
  const [hover, setHover] = useState(false);
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className="row gap-2"
      style={{
        padding: "10px 14px",
        borderTop: "1px solid var(--border)",
        fontSize: 13,
        background: hover ? "var(--bg-overlay)" : "transparent",
      }}
    >
      <span style={{ width: 90 }}>
        <StatusBadge status={d.status} />
      </span>
      <span className="mono" style={{ width: 90, color: "var(--fg-2)" }}>
        {d.service}
      </span>
      <span style={{ flex: 1, display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
        <span className="mono" style={{ color: "var(--fg-2)" }}>
          {d.commit}
        </span>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {d.msg}
        </span>
      </span>
      <span className="muted" style={{ width: 80, fontSize: 12 }}>
        {d.author}
      </span>
      <span className="mono muted" style={{ width: 80, textAlign: "right", fontSize: 12 }}>
        {d.dur}
      </span>
      <span className="muted" style={{ width: 80, textAlign: "right", fontSize: 12 }}>
        {d.when}
      </span>
      <span style={{ width: 36, textAlign: "right" }}>
        {canRollback && hover && (
          <button className="btn sm" onClick={() => onRollback(d)}>
            <I.refresh width={11} height={11} /> Rollback
          </button>
        )}
      </span>
    </div>
  );
}
