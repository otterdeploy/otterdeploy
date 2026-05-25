import { useState, type ReactNode } from "react";

import { Field as ShadField, FieldLabel } from "@/shared/components/ui/field";
import { Switch } from "@/shared/components/ui/switch";

// ─── Builder card classes ────────────────────────────────────────────────────
// Replaces the .os-builder / .os-builder.active / .os-builder-icon /
// .os-builder-pop global CSS rules. Exported so step files can compose with cn().
export const builderCardClass =
  "relative cursor-pointer rounded-md border border-border bg-card p-3.5 text-left text-foreground transition-colors hover:border-ring";

export const builderCardActiveClass =
  "border-foreground bg-accent shadow-[inset_0_0_0_1px_var(--foreground)]";

export const builderIconClass =
  "grid size-[26px] place-items-center rounded-[5px] border border-border bg-muted text-muted-foreground";

export const builderPopClass =
  "absolute top-2 right-2 rounded-[3px] bg-info/10 px-1.5 py-px text-[9px] uppercase tracking-[0.08em] text-info";

export function SectionHeader({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="mb-2.5 flex items-baseline gap-2.5">
      <h3 className="text-[13px] font-semibold tracking-[0.01em]">{title}</h3>
      {sub && <span className="text-xs text-muted-foreground">{sub}</span>}
    </div>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <ShadField>
      <FieldLabel className="text-[11px] font-normal text-muted-foreground">{label}</FieldLabel>
      {children}
    </ShadField>
  );
}

export function Switch3({ on, onChange }: { on: boolean; onChange?: (v: boolean) => void }) {
  const [v, setV] = useState(on);
  return (
    <Switch
      size="sm"
      checked={v}
      onCheckedChange={(next) => {
        setV(next);
        onChange?.(next);
      }}
    />
  );
}

export function SettingRow({
  label,
  sub,
  defaultOn,
}: {
  label: string;
  sub?: string;
  defaultOn?: boolean;
}) {
  const [on, setOn] = useState(!!defaultOn);
  return (
    <div className="flex items-center gap-3 border-t py-2.5">
      <div className="flex-1">
        <div className="text-[13px] font-medium">{label}</div>
        {sub && <div className="text-[11px] text-muted-foreground">{sub}</div>}
      </div>
      <Switch3 on={on} onChange={setOn} />
    </div>
  );
}
