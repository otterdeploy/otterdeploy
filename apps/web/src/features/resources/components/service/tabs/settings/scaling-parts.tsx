/**
 * Presentational rows for the scaling card — the replica stepper and the
 * per-replica limit fields (+ cluster-fit hint). Split out of
 * `scaling-card.tsx` so the form component stays within the size + complexity
 * budgets. The placement readout lives in `scaling-placement.tsx`.
 */

import { MinusSignIcon, PlusSignIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";

import {
  CPU_LIMIT_MAX,
  CPU_LIMIT_MIN,
  MEMORY_LIMIT_MAX_MB,
  MEMORY_LIMIT_MIN_MB,
  type ScalingFormValues,
} from "./scaling-math";

export const rowClass = "border-b border-border/40 px-3 py-2.5 last:border-b-0";

function LimitField({
  label,
  value,
  onChange,
  min,
  max,
  step,
  suffix,
  invalid,
}: {
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
  min: number;
  max: number;
  step: number;
  suffix: string;
  invalid: boolean;
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <div className="flex items-center gap-1.5">
        <Input
          type="number"
          // Empty input = "no limit" — an honest unset, not zero.
          value={value ?? ""}
          min={min}
          max={max}
          step={step}
          placeholder="no limit"
          onChange={(e) => {
            const v = e.target.valueAsNumber;
            onChange(Number.isNaN(v) ? null : v);
          }}
          className="h-8 font-mono text-[12.5px]"
          aria-invalid={invalid}
        />
        <span className="shrink-0 text-[11px] text-muted-foreground">{suffix}</span>
      </div>
    </label>
  );
}

/** Replica stepper row — count, ± buttons, and the plain-docker caveat. */
export function ReplicasRow({
  replicas,
  paused,
  plainDocker,
  saving,
  invalid,
  onChange,
}: {
  replicas: number;
  paused: boolean;
  plainDocker: boolean;
  saving: boolean;
  invalid: boolean;
  onChange: (next: number) => void;
}) {
  return (
    <div className={rowClass}>
      <div className="flex items-center gap-2">
        <div className="flex flex-col">
          <span className="text-[13px] font-medium">Replicas</span>
          <span className="text-[11px] text-muted-foreground">
            {paused
              ? "Paused — this is the count Resume restores. Changing it resumes the service with the new count."
              : "Running copies of this service. Use Pause to stop it without losing config."}
          </span>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label="Decrease replicas"
            disabled={replicas <= 1 || saving}
            onClick={() => onChange(replicas - 1)}
          >
            <HugeiconsIcon icon={MinusSignIcon} strokeWidth={2} className="size-3" />
          </Button>
          <Input
            type="number"
            value={Number.isNaN(replicas) ? "" : replicas}
            min={1}
            onChange={(e) => onChange(e.target.valueAsNumber)}
            className="h-8 w-16 text-center font-mono text-[13px]"
            aria-label="Replica count"
            aria-invalid={invalid}
          />
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label="Increase replicas"
            disabled={(plainDocker && replicas >= 1) || saving}
            onClick={() => onChange(replicas + 1)}
          >
            <HugeiconsIcon icon={PlusSignIcon} strokeWidth={2} className="size-3" />
          </Button>
        </div>
      </div>
      {plainDocker && (
        <div className="mt-1.5 text-[11px] text-muted-foreground">
          Plain Docker runs a single container per service — scaling out needs the Swarm runtime.
        </div>
      )}
    </div>
  );
}

/** Per-replica CPU / memory limits + the cluster-fit hint line. */
export function LimitsRow({
  form,
  cpuValid,
  memValid,
  fitLine,
  onPatch,
}: {
  form: ScalingFormValues;
  cpuValid: boolean;
  memValid: boolean;
  fitLine: string | null;
  onPatch: (patch: Partial<ScalingFormValues>) => void;
}) {
  return (
    <div className={rowClass}>
      <div className="grid grid-cols-2 gap-3">
        <LimitField
          label="CPU limit (per replica)"
          value={form.cpuLimit}
          onChange={(cpuLimit) => onPatch({ cpuLimit })}
          min={CPU_LIMIT_MIN}
          max={CPU_LIMIT_MAX}
          step={0.1}
          suffix="vCPU"
          invalid={!cpuValid}
        />
        <LimitField
          label="Memory limit (per replica)"
          value={form.memoryLimitMb}
          onChange={(memoryLimitMb) => onPatch({ memoryLimitMb })}
          min={MEMORY_LIMIT_MIN_MB}
          max={MEMORY_LIMIT_MAX_MB}
          step={64}
          suffix="MB"
          invalid={!memValid}
        />
      </div>
      <div className="mt-1.5 text-[11px] text-muted-foreground">
        {form.cpuLimit === null && form.memoryLimitMb === null
          ? "No limits set — replicas may use whatever the host has free."
          : fitLine
            ? `${fitLine} (${form.replicas} × per-replica limits vs registered servers).`
            : "Server capacity unknown — can't check fit."}
      </div>
    </div>
  );
}
