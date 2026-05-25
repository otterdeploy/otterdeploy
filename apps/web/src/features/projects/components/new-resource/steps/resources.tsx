import type { AnyFieldApi } from "@tanstack/react-form";

import { NODES, RESOURCE_PRESETS } from "@/features/projects/data/service-kinds";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent } from "@/shared/components/ui/card";
import { Checkbox } from "@/shared/components/ui/checkbox";
import { Input } from "@/shared/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { Slider } from "@/shared/components/ui/slider";
import { cn } from "@/shared/lib/utils";

import { Field, SectionHeader, SettingRow } from "../form-primitives";
import { I } from "../icons";

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
      <SectionHeader title="Size" sub="How much CPU and memory does each replica get?" />
      <div className="mt-3 grid grid-cols-3 gap-2.5">
        {RESOURCE_PRESETS.map((p) => {
          const isActive = presetId === p.id;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => presetIdField.handleChange(p.id)}
              className={cn(
                "relative min-h-24 rounded-md border bg-card p-3.5 text-left text-foreground transition-colors hover:border-ring",
                isActive &&
                  "border-foreground bg-accent shadow-[0_0_0_1px_var(--foreground)_inset]",
              )}
            >
              {p.popular && (
                <span className="absolute top-2 right-2 rounded-sm bg-info/12 px-1.5 py-px text-[9px] font-medium uppercase tracking-[0.08em] text-info">
                  popular
                </span>
              )}
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold">{p.name}</span>
                {isActive && (
                  <I.check width={12} height={12} className="ml-auto text-foreground" />
                )}
              </div>
              <div className="mt-1.5 font-mono text-xs text-muted-foreground">
                {p.cpu != null && p.mem != null
                  ? `${p.cpu} vCPU · ${p.mem >= 1024 ? p.mem / 1024 + " GB" : p.mem + " MB"}`
                  : "configure manually"}
              </div>
              <div className="mt-1 text-[11px] text-muted-foreground">{p.sub}</div>
            </button>
          );
        })}
      </div>

      {presetId === "custom" && (
        <Card className="mt-3 p-4">
          <Field label={`CPU · ${customCpu} vCPU`}>
            <Slider
              min={0.1}
              max={8}
              step={0.1}
              value={[customCpu]}
              onValueChange={(v) => {
                const next = Array.isArray(v) ? v[0] : v;
                if (typeof next === "number") customCpuField.handleChange(next);
              }}
            />
          </Field>
          <div className="mt-3">
            <Field
              label={`Memory · ${customMem >= 1024 ? (customMem / 1024).toFixed(1) + " GB" : customMem + " MB"}`}
            >
              <Slider
                min={128}
                max={16384}
                step={128}
                value={[customMem]}
                onValueChange={(v) => {
                  const next = Array.isArray(v) ? v[0] : v;
                  if (typeof next === "number") customMemField.handleChange(next);
                }}
              />
            </Field>
          </div>
        </Card>
      )}

      {!isDb && (
        <>
          <div className="mt-4.5">
            <SectionHeader title="Replicas" sub="How many copies of this service to run?" />
          </div>
          <Card className="mt-2.5 p-4">
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => replicasField.handleChange(Math.max(1, replicas - 1))}
                aria-label="Decrease replicas"
              >
                <I.x width={11} height={11} />
              </Button>
              <Input
                type="number"
                value={replicas}
                onChange={(e) => replicasField.handleChange(+e.target.value || 1)}
                className="h-9 w-[70px] text-center font-mono text-base"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => replicasField.handleChange(replicas + 1)}
                aria-label="Increase replicas"
              >
                <I.plus width={11} height={11} />
              </Button>
              <div className="flex-1" />
              <span className="font-mono text-[11px] text-muted-foreground">
                scale up to {replicas * 5} via autoscaler
              </span>
            </div>
            <div className="mt-3.5">
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
          </Card>
        </>
      )}

      <div className="mt-4.5">
        <SectionHeader
          title="Placement"
          sub={`Where should this run? · ${NODES.length} nodes available in the swarm`}
        />
      </div>
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

          <div className="mt-3.5 rounded-sm border border-border bg-muted p-3">
            <div className="mb-2 text-[10px] uppercase tracking-[0.06em] text-muted-foreground">
              {placement === "pin" ? "pick a node" : "predicted placement"}
            </div>
            <div className="flex items-center gap-2">
              {NODES.map((n, ni) => {
                const onThis =
                  placement === "spread"
                    ? ni < replicas
                      ? 1
                      : 0
                    : placement === "pack"
                      ? ni === 0
                        ? replicas
                        : 0
                      : placement === "pin"
                        ? n.id === pinnedNodeId
                          ? replicas
                          : 0
                        : Math.ceil((replicas - ni) / NODES.length);
                const isPinned = placement === "pin" && n.id === pinnedNodeId;
                return (
                  <div
                    key={n.id}
                    className="flex-1 rounded-sm border border-border bg-card p-2.5"
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
                      <span className="text-muted-foreground">
                        {Math.round((n.cpu.used / n.cpu.total) * 100)}%
                      </span>
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1">
                      {Array.from({ length: Math.max(0, onThis) }).map((_, i) => (
                        <span
                          key={i}
                          className="inline-block size-2.5 rounded-[2px] bg-chart-2"
                        />
                      ))}
                      {onThis === 0 && (
                        <span className="text-[10px] text-muted-foreground">—</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="mt-3.5 rounded-md bg-muted py-3.5">
        <CardContent className="px-3.5">
          <div className="flex items-center gap-3">
            <div>
              <div className="text-[10px] uppercase tracking-[0.06em] text-muted-foreground">
                service total
              </div>
              <div className="mt-0.5 font-mono text-sm font-medium">
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
