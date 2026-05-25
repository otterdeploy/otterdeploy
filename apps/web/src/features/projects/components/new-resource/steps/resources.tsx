import { useStore } from "@tanstack/react-form";

import { NODES, RESOURCE_PRESETS } from "@/features/projects/data/service-kinds";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent } from "@/shared/components/ui/card";
import { Checkbox } from "@/shared/components/ui/checkbox";
import { Input } from "@/shared/components/ui/input";
import { cn } from "@/shared/lib/utils";

import {
  builderCardActiveClass,
  builderCardClass,
  builderPopClass,
  SectionHeader,
  SettingRow,
} from "../form-primitives";
import { useFormContext } from "../form-context";
import { I } from "../icons";

interface StepResourcesProps {
  isDb: boolean;
}

export function StepResources({ isDb }: StepResourcesProps) {
  const form = useFormContext();
  const presetId = useStore(form.store, (s) => s.values.presetId as string);
  const customCpu = useStore(form.store, (s) => s.values.customCpu as number);
  const customMem = useStore(form.store, (s) => s.values.customMem as number);
  const replicas = useStore(form.store, (s) => s.values.replicas as number);
  const placement = useStore(form.store, (s) => s.values.placement as string);
  const pinnedNodeId = useStore(form.store, (s) => s.values.pinnedNodeId as string | null);

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
              onClick={() => form.setFieldValue("presetId", p.id)}
              className={cn(
                builderCardClass,
                "min-h-24",
                isActive && builderCardActiveClass,
              )}
            >
              {p.popular && <span className={builderPopClass}>popular</span>}
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
          <CardContent className="grid grid-cols-2 gap-3 p-0">
            <form.AppField name="customCpu">
              {(f) => <f.NumberField label="vCPU" min={0.1} step={0.1} className="font-mono" />}
            </form.AppField>
            <form.AppField name="customMem">
              {(f) => <f.NumberField label="Memory (MB)" min={128} step={64} className="font-mono" />}
            </form.AppField>
          </CardContent>
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
                onClick={() => form.setFieldValue("replicas", Math.max(1, replicas - 1))}
                aria-label="Decrease replicas"
              >
                <I.x width={11} height={11} />
              </Button>
              <Input
                type="number"
                value={replicas}
                onChange={(e) => form.setFieldValue("replicas", +e.target.value || 1)}
                className="h-9 w-[70px] text-center font-mono text-base"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => form.setFieldValue("replicas", replicas + 1)}
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
          <form.AppField name="placement">
            {(f) => (
              <f.SelectField
                label="Placement strategy"
                items={[
                  { label: "Any node — let scheduler decide", value: "any" },
                  { label: "Spread across nodes — one replica per node", value: "spread" },
                  { label: "Pack onto fewest nodes — minimize spread", value: "pack" },
                  { label: "Pin to specific node", value: "pin" },
                ]}
              />
            )}
          </form.AppField>

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
                            if (checked) form.setFieldValue("pinnedNodeId", n.id);
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
