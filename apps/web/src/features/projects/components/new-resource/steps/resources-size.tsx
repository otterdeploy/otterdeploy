/**
 * Size presets + replicas sections for the Resources step. Split out of
 * resources.tsx so that file + its main component stay under the line caps.
 */

import { useStore } from "@tanstack/react-form";

import { RESOURCE_PRESETS } from "@/features/projects/data/service-kinds";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent } from "@/shared/components/ui/card";
import { Input } from "@/shared/components/ui/input";
import { cn } from "@/shared/lib/utils";

import { useFormContext } from "../form-context";
import {
  builderCardActiveClass,
  builderCardClass,
  builderPopClass,
  SectionHeader,
  SettingRow,
} from "../form-primitives";
import { I } from "../icons";

export function SizePresets() {
  const form = useFormContext();
  const presetId = useStore(form.store, (s) => s.values.presetId);

  return (
    <>
      <div className="mt-3 grid grid-cols-3 gap-2.5">
        {RESOURCE_PRESETS.map((p) => {
          const isActive = presetId === p.id;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => form.setFieldValue("presetId", p.id)}
              className={cn(builderCardClass, "min-h-24", isActive && builderCardActiveClass)}
            >
              {p.popular && <span className={builderPopClass}>popular</span>}
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold">{p.name}</span>
                {isActive && <I.check width={12} height={12} className="ml-auto text-foreground" />}
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
              {(f) => (
                <f.NumberField label="Memory (MB)" min={128} step={64} className="font-mono" />
              )}
            </form.AppField>
          </CardContent>
        </Card>
      )}
    </>
  );
}

export function ReplicasSection() {
  const form = useFormContext();
  const replicas = useStore(form.store, (s) => s.values.replicas);

  return (
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
            className="h-9 w-17.5 text-center font-mono text-base"
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
  );
}
