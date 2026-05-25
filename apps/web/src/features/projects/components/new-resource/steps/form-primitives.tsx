// Form primitives ported from apps/web-demo/src/features/otterstack/components/form.tsx.
// Now backed by shadcn primitives (Switch, Field, FieldLabel) with thin
// wrappers that preserve the original `{ label, children }` / `{ on, onChange }`
// API so callers don't need to change.
import { useState, type ReactNode } from "react";

import {
  Field as ShadField,
  FieldLabel,
} from "@/shared/components/ui/field";
import { Switch } from "@/shared/components/ui/switch";

// ────────── SectionH ──────────
export function SectionH({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="mb-2.5 flex items-baseline gap-2.5">
      <h3 className="text-[13px] font-semibold tracking-[0.01em]">{title}</h3>
      {sub && <span className="text-xs text-muted-foreground">{sub}</span>}
    </div>
  );
}

// ────────── Field ──────────
// Thin wrapper around shadcn Field + FieldLabel that keeps the original
// `{ label, children }` shape used across the new-resource step files.
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <ShadField>
      <FieldLabel className="text-[11px] font-normal text-muted-foreground">
        {label}
      </FieldLabel>
      {children}
    </ShadField>
  );
}

// ────────── Switch3 ──────────
// Wrapper around shadcn Switch that preserves the original
// `{ on, onChange }` API (controlled internally, optional external callback).
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

// ────────── SettingRow ──────────
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
