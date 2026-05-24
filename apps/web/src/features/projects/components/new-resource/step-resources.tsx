// Step_Resources — pick a size preset and configure placement.
// Ported verbatim from apps/web-demo/src/features/otterstack/screens/new-service.tsx lines 1912-2255.
import type { AnyFieldApi } from "@tanstack/react-form";
import { RESOURCE_PRESETS, NODES } from "@/features/projects/data/service-kinds";
import { I } from "./icons";
import { SectionH, Field, SettingRow } from "./form-primitives";

type ResourcesProps = {
  presetIdField: AnyFieldApi;
  customCpuField: AnyFieldApi;
  customMemField: AnyFieldApi;
  replicasField: AnyFieldApi;
  placementField: AnyFieldApi;
  isDb: boolean;
};

export function StepResources({
  presetIdField,
  customCpuField,
  customMemField,
  replicasField,
  placementField,
  isDb,
}: ResourcesProps) {
  const presetId = presetIdField.state.value as string;
  const customCpu = customCpuField.state.value as number;
  const customMem = customMemField.state.value as number;
  const replicas = replicasField.state.value as number;
  const placement = placementField.state.value as string;

  const preset = RESOURCE_PRESETS.find((p) => p.id === presetId);
  const cpu = preset?.cpu ?? customCpu;
  const mem = preset?.mem ?? customMem;
  const totalCpu = (cpu * replicas).toFixed(2);
  const totalMem = ((mem * replicas) / 1024).toFixed(2);

  return (
    <>
      <SectionH title="Size" sub="How much CPU and memory does each replica get?" />
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: 10,
          marginTop: 12,
        }}
      >
        {RESOURCE_PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => presetIdField.handleChange(p.id)}
            className={`os-builder ${presetId === p.id ? "active" : ""}`}
            style={{ minHeight: 96 }}
          >
            {p.popular && <span className="os-builder-pop">popular</span>}
            <div className="os-row os-gap-2">
              <span style={{ fontWeight: 600, fontSize: 14 }}>{p.name}</span>
              {presetId === p.id && (
                <I.check
                  width={12}
                  height={12}
                  style={{ marginLeft: "auto", color: "var(--foreground)" }}
                />
              )}
            </div>
            <div className="os-mono" style={{ fontSize: 12, marginTop: 6, color: "var(--muted-foreground)" }}>
              {p.cpu != null && p.mem != null
                ? `${p.cpu} vCPU · ${p.mem >= 1024 ? p.mem / 1024 + " GB" : p.mem + " MB"}`
                : "configure manually"}
            </div>
            <div className="os-muted" style={{ fontSize: 11, marginTop: 4 }}>{p.sub}</div>
          </button>
        ))}
      </div>

      {presetId === "custom" && (
        <div className="card" style={{ padding: 16, marginTop: 12 }}>
          <Field label={`CPU · ${customCpu} vCPU`}>
            <input
              type="range"
              min="0.1"
              max="8"
              step="0.1"
              value={customCpu}
              onChange={(e) => customCpuField.handleChange(+e.target.value)}
              style={{ width: "100%" }}
            />
          </Field>
          <div style={{ height: 12 }} />
          <Field
            label={`Memory · ${customMem >= 1024 ? (customMem / 1024).toFixed(1) + " GB" : customMem + " MB"}`}
          >
            <input
              type="range"
              min="128"
              max="16384"
              step="128"
              value={customMem}
              onChange={(e) => customMemField.handleChange(+e.target.value)}
              style={{ width: "100%" }}
            />
          </Field>
        </div>
      )}

      {!isDb && (
        <>
          <div style={{ height: 18 }} />
          <SectionH title="Replicas" sub="How many copies of this service to run?" />
          <div className="card" style={{ padding: 16, marginTop: 10 }}>
            <div className="os-row os-gap-2">
              <button
                type="button"
                className="btn ghost icon"
                onClick={() => replicasField.handleChange(Math.max(1, replicas - 1))}
              >
                <I.x width={11} height={11} />
              </button>
              <input
                className="input os-mono"
                type="number"
                value={replicas}
                onChange={(e) => replicasField.handleChange(+e.target.value || 1)}
                style={{ width: 70, textAlign: "center", fontSize: 16, height: 36 }}
              />
              <button
                type="button"
                className="btn ghost icon"
                onClick={() => replicasField.handleChange(replicas + 1)}
              >
                <I.plus width={11} height={11} />
              </button>
              <div style={{ flex: 1 }} />
              <span className="os-muted os-mono" style={{ fontSize: 11 }}>
                scale up to {replicas * 5} via autoscaler
              </span>
            </div>
            <div style={{ height: 14 }} />
            <SettingRow
              label="Enable autoscaling"
              sub={`Scale between ${replicas} and ${replicas * 5} replicas based on CPU > 60%`}
            />
            <SettingRow
              label="Zero-downtime rolling deploy"
              defaultOn
              sub="Drain old replicas only after new ones report ready"
            />
          </div>
        </>
      )}

      <div style={{ height: 18 }} />
      <SectionH
        title="Placement"
        sub={`Where should this run? · ${NODES.length} nodes available in the swarm`}
      />
      <div className="card" style={{ padding: 16, marginTop: 10 }}>
        <Field label="Placement strategy">
          <select
            className="input"
            value={placement}
            onChange={(e) => placementField.handleChange(e.target.value)}
          >
            <option value="any">Any node — let scheduler decide</option>
            <option value="spread">Spread across nodes — one replica per node</option>
            <option value="pack">Pack onto fewest nodes — minimize spread</option>
            <option value="pin">Pin to specific node</option>
          </select>
        </Field>

        <div
          style={{
            marginTop: 14,
            padding: 12,
            background: "var(--muted)",
            borderRadius: 6,
            border: "1px solid var(--border)",
          }}
        >
          <div
            className="os-muted"
            style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}
          >
            predicted placement
          </div>
          <div className="os-row os-gap-2">
            {NODES.map((n, ni) => {
              const onThis =
                placement === "spread"
                  ? ni < replicas ? 1 : 0
                  : placement === "pack"
                    ? ni === 0 ? replicas : 0
                    : Math.ceil((replicas - ni) / NODES.length);
              return (
                <div
                  key={n.id}
                  style={{
                    flex: 1,
                    padding: 10,
                    background: "var(--card)",
                    borderRadius: 5,
                    border: "1px solid var(--border)",
                  }}
                >
                  <div className="os-row os-gap-2" style={{ fontSize: 11 }}>
                    <span className="os-mono" style={{ color: "var(--muted-foreground)" }}>{n.name}</span>
                    <span style={{ flex: 1 }} />
                    <span className="os-muted">{Math.round((n.cpu.used / n.cpu.total) * 100)}%</span>
                  </div>
                  <div className="os-row os-gap-1" style={{ marginTop: 6, flexWrap: "wrap" }}>
                    {Array.from({ length: Math.max(0, onThis) }).map((_, i) => (
                      <span
                        key={i}
                        style={{
                          display: "inline-block",
                          width: 10,
                          height: 10,
                          borderRadius: 2,
                          background: "var(--chart-2)",
                        }}
                      />
                    ))}
                    {onThis === 0 && <span className="os-muted" style={{ fontSize: 10 }}>—</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div style={{ height: 14 }} />
      <div className="card" style={{ padding: 14, background: "var(--muted)" }}>
        <div className="os-row os-gap-3">
          <div>
            <div
              className="os-muted"
              style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em" }}
            >
              service total
            </div>
            <div className="os-mono" style={{ fontSize: 14, fontWeight: 500, marginTop: 2 }}>
              {totalCpu} vCPU · {totalMem} GB
            </div>
          </div>
          <div style={{ flex: 1 }} />
        </div>
      </div>
    </>
  );
}
