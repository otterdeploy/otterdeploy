// Step_Resources — pick a size preset and configure placement.
// Ported verbatim from apps/web-demo/src/features/otterstack/screens/new-service.tsx lines 1912-2255.
import type { AnyFieldApi } from "@tanstack/react-form";
import { RESOURCE_PRESETS, NODES } from "@/features/projects/data/service-kinds";
import { I } from "./icons";
import { SectionH, Field, SettingRow } from "./form-primitives";
import { Card, CardContent } from "@/shared/components/ui/card";
import { Checkbox } from "@/shared/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";

interface ResourcesProps {
  presetIdField: AnyFieldApi;
  customCpuField: AnyFieldApi;
  customMemField: AnyFieldApi;
  replicasField: AnyFieldApi;
  placementField: AnyFieldApi;
  pinnedNodeIdField: AnyFieldApi;
  isDb: boolean;
}

export function StepResources({
  presetIdField,
  customCpuField,
  customMemField,
  replicasField,
  placementField,
  pinnedNodeIdField,
  isDb,
}: ResourcesProps) {
  const presetId = presetIdField.state.value as string;
  const customCpu = customCpuField.state.value as number;
  const customMem = customMemField.state.value as number;
  const replicas = replicasField.state.value as number;
  const placement = placementField.state.value as string;
  const pinnedNodeId = pinnedNodeIdField.state.value as string | null;

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
            <div className="flex items-center gap-2">
              <span style={{ fontWeight: 600, fontSize: 14 }}>{p.name}</span>
              {presetId === p.id && (
                <I.check
                  width={12}
                  height={12}
                  style={{ marginLeft: "auto", color: "var(--foreground)" }}
                />
              )}
            </div>
            <div className="font-mono" style={{ fontSize: 12, marginTop: 6, color: "var(--muted-foreground)" }}>
              {p.cpu != null && p.mem != null
                ? `${p.cpu} vCPU · ${p.mem >= 1024 ? p.mem / 1024 + " GB" : p.mem + " MB"}`
                : "configure manually"}
            </div>
            <div className="text-muted-foreground" style={{ fontSize: 11, marginTop: 4 }}>{p.sub}</div>
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
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="btn ghost icon"
                onClick={() => replicasField.handleChange(Math.max(1, replicas - 1))}
              >
                <I.x width={11} height={11} />
              </button>
              <input
                className="input font-mono"
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
              <span className="text-muted-foreground font-mono" style={{ fontSize: 11 }}>
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

      <div className="h-[18px]" />
      <SectionH
        title="Placement"
        sub={`Where should this run? · ${NODES.length} nodes available in the swarm`}
      />
      <Card className="mt-2.5 rounded-md">
        <CardContent>
          <Field label="Placement strategy">
            <Select
              value={placement}
              onValueChange={(v) => v && placementField.handleChange(v)}
              items={[
                { label: "Any node — let scheduler decide", value: "any" },
                { label: "Spread across nodes — one replica per node", value: "spread" },
                { label: "Pack onto fewest nodes — minimize spread", value: "pack" },
                { label: "Pin to specific node", value: "pin" },
              ]}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="any">Any node — let scheduler decide</SelectItem>
                <SelectItem value="spread">Spread across nodes — one replica per node</SelectItem>
                <SelectItem value="pack">Pack onto fewest nodes — minimize spread</SelectItem>
                <SelectItem value="pin">Pin to specific node</SelectItem>
              </SelectContent>
            </Select>
          </Field>

          <div className="mt-3.5 p-3 bg-muted rounded-sm border border-border">
            <div className="text-muted-foreground text-[10px] uppercase tracking-[0.06em] mb-2">
              {placement === "pin" ? "pick a node" : "predicted placement"}
            </div>
            <div className="flex items-center gap-2">
              {NODES.map((n, ni) => {
                const onThis =
                  placement === "spread"
                    ? ni < replicas ? 1 : 0
                    : placement === "pack"
                      ? ni === 0 ? replicas : 0
                      : placement === "pin"
                        ? n.id === pinnedNodeId ? replicas : 0
                        : Math.ceil((replicas - ni) / NODES.length);
                const isPinned = placement === "pin" && n.id === pinnedNodeId;
                return (
                  <div
                    key={n.id}
                    className="flex-1 p-2.5 bg-card rounded-sm border border-border"
                  >
                    <div className="flex items-center gap-2 text-[11px]">
                      {placement === "pin" && (
                        <Checkbox
                          checked={isPinned}
                          onCheckedChange={(checked) => {
                            if (checked) pinnedNodeIdField.handleChange(n.id);
                          }}
                          aria-label={`Pin to ${n.name}`}
                        />
                      )}
                      <span className="font-mono text-muted-foreground">{n.name}</span>
                      <span className="flex-1" />
                      <span className="text-muted-foreground">{Math.round((n.cpu.used / n.cpu.total) * 100)}%</span>
                    </div>
                    <div className="flex items-center gap-1 mt-1.5 flex-wrap">
                      {Array.from({ length: Math.max(0, onThis) }).map((_, i) => (
                        <span
                          key={i}
                          className="inline-block w-2.5 h-2.5 rounded-[2px] bg-chart-2"
                        />
                      ))}
                      {onThis === 0 && <span className="text-muted-foreground text-[10px]">—</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="h-3.5" />
      <Card className="bg-muted py-3.5 rounded-md">
        <CardContent className="px-3.5">
          <div className="flex items-center gap-3">
            <div>
              <div className="text-muted-foreground text-[10px] uppercase tracking-[0.06em]">
                service total
              </div>
              <div className="font-mono text-sm font-medium mt-0.5">
                {totalCpu} vCPU · {totalMem} GB
              </div>
            </div>
            <div className="flex-1" />
          </div>
        </CardContent>
      </Card>
    </>
  );
}
