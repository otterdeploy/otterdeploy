/**
 * Input row for the health-check card — the probe path plus the interval /
 * timeout / retries number fields. Split out of `health-check-card.tsx` to
 * keep that module within the file-size budget.
 */

import { Input } from "@/shared/components/ui/input";

import type { HealthCheckFormState } from "./health-check-form";

function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  suffix,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  suffix?: string;
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <div className="flex items-center gap-1.5">
        <Input
          type="number"
          value={Number.isNaN(value) ? "" : value}
          min={min}
          max={max}
          onChange={(e) => onChange(e.target.valueAsNumber)}
          className="h-8 font-mono text-[12.5px]"
          aria-invalid={Number.isNaN(value) || value < min || value > max}
        />
        {suffix && <span className="text-[11px] text-muted-foreground">{suffix}</span>}
      </div>
    </label>
  );
}

/** Path + interval / timeout / retries inputs. */
export function FieldsRow({
  form,
  pathValid,
  onPatch,
}: {
  form: HealthCheckFormState;
  pathValid: boolean;
  onPatch: (patch: Partial<HealthCheckFormState>) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-3 border-b border-border/40 px-3 py-2.5 last:border-b-0 sm:grid-cols-[2fr_1fr_1fr_1fr]">
      <label className="flex min-w-0 flex-col gap-1">
        <span className="text-[11px] text-muted-foreground">Path</span>
        <Input
          value={form.path}
          onChange={(e) => onPatch({ path: e.target.value })}
          placeholder="/health"
          className="h-8 font-mono text-[12.5px]"
          aria-invalid={!pathValid}
        />
      </label>
      <NumberField
        label="Interval"
        value={form.intervalS}
        onChange={(v) => onPatch({ intervalS: v })}
        min={1}
        max={3600}
        suffix="s"
      />
      <NumberField
        label="Timeout"
        value={form.timeoutS}
        onChange={(v) => onPatch({ timeoutS: v })}
        min={1}
        max={600}
        suffix="s"
      />
      <NumberField
        label="Retries"
        value={form.retries}
        onChange={(v) => onPatch({ retries: v })}
        min={0}
        max={20}
      />
    </div>
  );
}
