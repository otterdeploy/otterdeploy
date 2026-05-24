// Form primitives ported from apps/web-demo/src/features/otterstack/components/form.tsx.
// Pass A only needs SectionH and Field. The rest (Switch3, SettingRow, BuilderConfig,
// BuilderCard) will be added in Pass B when the wizard steps are wired.
import type { ReactNode } from "react";

// ────────── SectionH ──────────
export function SectionH({ title, sub }: { title: string; sub?: string }) {
  return (
    <div style={{ marginBottom: 10, display: "flex", alignItems: "baseline", gap: 10 }}>
      <h3 style={{ margin: 0, fontSize: 13, fontWeight: 600, letterSpacing: "0.01em" }}>{title}</h3>
      {sub && <span className="os-muted" style={{ fontSize: 12 }}>{sub}</span>}
    </div>
  );
}

// ────────── Field ──────────
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span className="os-muted" style={{ fontSize: 11 }}>{label}</span>
      {children}
    </label>
  );
}
