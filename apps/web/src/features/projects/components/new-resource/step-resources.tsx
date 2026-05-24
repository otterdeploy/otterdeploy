// Step_Resources — pick a size preset and configure placement.
// Ported verbatim from apps/web-demo/src/features/otterstack/screens/new-service.tsx lines 1912-2255.
// Change 1: region picker removed. Change 2: cost display removed. Change 4: Tailwind conversion.
import type { AnyFieldApi } from "@tanstack/react-form";
import { RESOURCE_PRESETS, NODES } from "@/features/projects/data/service-kinds";
import { I } from "./icons";
import { SectionH, Field, SettingRow } from "./form-primitives";
import { cn } from "@/shared/lib/utils";

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
      <div className="grid grid-cols-3 gap-[10px] mt-3">
        {RESOURCE_PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => presetIdField.handleChange(p.id)}
            className={cn(
              "relative p-[14px] bg-card border border-border rounded-lg cursor-pointer text-left font-[inherit] text-foreground hover:border-ring min-h-[96px]",
              presetId === p.id && "border-foreground shadow-[0_0_0_1px_var(--foreground)_inset] bg-accent",
            )}
          >
            {p.popular && (
              <span className="absolute top-2 right-2 text-[9px] uppercase tracking-[0.08em] px-1.5 py-px rounded-[3px] bg-[oklch(from_var(--info)_l_c_h_/_12%)] text-[var(--info)]">
                popular
              </span>
            )}
            <div className="flex items-center gap-2">
              <span className="font-semibold text-sm">{p.name}</span>
              {presetId === p.id && (
                <I.check
                  width={12}
                  height={12}
                  className="ml-auto text-foreground"
                />
              )}
            </div>
            <div className="font-mono text-xs mt-1.5 text-muted-foreground">
              {p.cpu != null && p.mem != null
                ? `${p.cpu} vCPU · ${p.mem >= 1024 ? p.mem / 1024 + " GB" : p.mem + " MB"}`
                : "configure manually"}
            </div>
            <div className="text-muted-foreground text-[11px] mt-1">{p.sub}</div>
          </button>
        ))}
      </div>

      {presetId === "custom" && (
        <div className="card p-4 mt-3">
          <Field label={`CPU · ${customCpu} vCPU`}>
            <input
              type="range"
              min="0.1"
              max="8"
              step="0.1"
              value={customCpu}
              onChange={(e) => customCpuField.handleChange(+e.target.value)}
              className="w-full"
            />
          </Field>
          <div className="h-3" />
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
              className="w-full"
            />
          </Field>
        </div>
      )}

      {!isDb && (
        <>
          <div className="h-[18px]" />
          <SectionH title="Replicas" sub="How many copies of this service to run?" />
          <div className="card p-4 mt-[10px]">
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
                style={{ width: 70, textAlign: "center", fontSize: 16, height: 36 }} // dynamic size kept inline
              />
              <button
                type="button"
                className="btn ghost icon"
                onClick={() => replicasField.handleChange(replicas + 1)}
              >
                <I.plus width={11} height={11} />
              </button>
              <div className="flex-1" />
              <span className="text-muted-foreground font-mono text-[11px]">
                scale up to {replicas * 5} via autoscaler
              </span>
            </div>
            <div className="h-[14px]" />
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
        sub={`Where should this run? · ${NODES.length} nodes available`}
      />
      <div className="card p-4 mt-[10px]">
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

        <div className="mt-[14px] p-3 bg-muted rounded-md border border-border">
          <div className="text-muted-foreground text-[10px] uppercase tracking-[0.06em] mb-2">
            predicted placement
          </div>
          <div className="flex items-center gap-2">
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
                  className="flex-1 p-[10px] bg-card rounded-[5px] border border-border"
                >
                  <div className="flex items-center gap-2 text-[11px]">
                    <span className="font-mono text-muted-foreground">{n.name}</span>
                    <span className="flex-1" />
                    <span className="text-muted-foreground">{Math.round((n.cpu.used / n.cpu.total) * 100)}%</span>
                  </div>
                  <div className="flex items-center gap-1 mt-1.5 flex-wrap">
                    {Array.from({ length: Math.max(0, onThis) }).map((_, i) => (
                      <span
                        key={i}
                        className="inline-block w-[10px] h-[10px] rounded-[2px] bg-[var(--chart-2)]"
                      />
                    ))}
                    {onThis === 0 && <span className="text-muted-foreground text-[10px]">—</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="h-[14px]" />
      <div className="card p-[14px] bg-muted">
        <div className="flex items-center gap-3">
          <div>
            <div className="text-muted-foreground text-[10px] uppercase tracking-[0.06em]">
              service total
            </div>
            <div className="font-mono text-sm font-medium mt-0.5">
              {totalCpu} vCPU · {totalMem} GB
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
