// Per-service Scaling form. Used by both:
//   - Settings → Scaling          (with a service picker on top)
//   - ServiceDetail → Scaling
import { useState } from "react";

import { I } from "../../icons";
import type { Service } from "../../data";
import { Field, SectionH, SettingRow } from "../form";

export function ScalingForm({ service }: { service: Service }) {
  const [replicas, setReplicas] = useState<number>(service.replicas || 2);
  const [cpu, setCpu] = useState(0.5);
  const [mem, setMem] = useState(512);

  return (
    <div className="col gap-4">
      <SectionH title="Replicas" sub="Number of running copies · changes apply via rolling update" />
      <div className="card" style={{ padding: 16 }}>
        <div className="row gap-2">
          <button
            className="btn ghost icon"
            onClick={() => setReplicas((r) => Math.max(1, r - 1))}
          >
            <I.x width={11} height={11} />
          </button>
          <input
            className="input mono"
            type="number"
            value={replicas}
            onChange={(e) => setReplicas(+e.target.value || 1)}
            style={{ width: 80, textAlign: "center", fontSize: 18, height: 36 }}
          />
          <button className="btn ghost icon" onClick={() => setReplicas((r) => r + 1)}>
            <I.plus width={11} height={11} />
          </button>
          <div style={{ flex: 1 }} />
          <span className="mono muted" style={{ fontSize: 11 }}>
            across {Math.min(replicas, 3)} node{replicas > 1 ? "s" : ""}
          </span>
        </div>
        <div
          className="row gap-1"
          style={{
            marginTop: 14,
            padding: 10,
            background: "var(--bg-sunken)",
            borderRadius: 6,
            border: "1px solid var(--border)",
          }}
        >
          {[0, 1, 2].map((n) => {
            const onThisNode = Math.ceil((replicas - n) / 3);
            const has = onThisNode > 0;
            return (
              <div
                key={n}
                style={{
                  flex: 1,
                  padding: 8,
                  borderRadius: 4,
                  background: has ? "var(--bg-elev)" : "transparent",
                  border: "1px solid var(--border)",
                }}
              >
                <div className="mono" style={{ fontSize: 10, color: "var(--fg-3)" }}>
                  node-{n + 1}
                </div>
                <div className="row gap-1" style={{ marginTop: 6, flexWrap: "wrap" }}>
                  {Array.from({ length: Math.max(0, onThisNode) }).map((_, i) => (
                    <span
                      key={i}
                      style={{
                        display: "inline-block",
                        width: 12,
                        height: 12,
                        borderRadius: 3,
                        background: "var(--ok)",
                      }}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <SectionH title="Resources (per replica)" />
      <div className="card" style={{ padding: 16 }}>
        <Field label={`CPU limit · ${cpu} vCPU`}>
          <input
            type="range"
            min="0.1"
            max="4"
            step="0.1"
            value={cpu}
            onChange={(e) => setCpu(+e.target.value)}
            style={{ width: "100%" }}
          />
        </Field>
        <div style={{ height: 8 }} />
        <Field
          label={`Memory limit · ${mem >= 1024 ? (mem / 1024).toFixed(1) + " GB" : mem + " MB"}`}
        >
          <input
            type="range"
            min="128"
            max="4096"
            step="128"
            value={mem}
            onChange={(e) => setMem(+e.target.value)}
            style={{ width: "100%" }}
          />
        </Field>
        <div
          className="row gap-3"
          style={{
            padding: 10,
            background: "var(--bg-sunken)",
            borderRadius: 6,
            border: "1px solid var(--border)",
            marginTop: 12,
          }}
        >
          <div>
            <div
              className="muted"
              style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em" }}
            >
              service total
            </div>
            <div className="mono" style={{ fontSize: 14, fontWeight: 500 }}>
              {(cpu * replicas).toFixed(1)} vCPU · {((mem * replicas) / 1024).toFixed(1)} GB
            </div>
          </div>
          <div style={{ flex: 1 }} />
          <span className="badge ok">
            <span className="dot" />
            fits cluster capacity
          </span>
        </div>
      </div>

      <SectionH title="Autoscaling" />
      <div className="card" style={{ padding: 16 }}>
        <SettingRow
          label="Enable autoscaling"
          sub="Add/remove replicas based on the chosen metric"
        />
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr",
            gap: 10,
            marginTop: 12,
          }}
        >
          <Field label="Metric">
            <select className="input">
              <option>CPU utilization</option>
              <option>Memory utilization</option>
              <option>Request latency (p95)</option>
            </select>
          </Field>
          <Field label="Target value">
            <input className="input mono" defaultValue="60%" />
          </Field>
          <Field label="Replica range">
            <input className="input mono" defaultValue="2 — 10" />
          </Field>
        </div>
      </div>
    </div>
  );
}
