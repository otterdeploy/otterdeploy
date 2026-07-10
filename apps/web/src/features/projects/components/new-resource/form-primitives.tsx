import type { ReactNode } from "react";

import { Field as ShadField, FieldLabel } from "@/shared/components/ui/field";

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
    <div className="mb-2.5">
      <h3 className="text-[13px] font-semibold tracking-[0.01em]">{title}</h3>
      {sub && (
        <p className="mt-1 max-w-prose text-xs leading-relaxed text-muted-foreground">{sub}</p>
      )}
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

// SettingRow (a switch whose state lived in local useState and never reached
// the form) is gone: every call site either got a real wired control or was
// removed in the wizard honesty sweep. If you need a toggle the backend
// honors, use `form.AppField` + `f.SwitchField` so the value actually lands
// in the manifest.
