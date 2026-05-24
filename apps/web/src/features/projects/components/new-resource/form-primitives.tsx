// Form primitives ported from apps/web-demo/src/features/otterstack/components/form.tsx.
// Pass B extended with Switch3 and SettingRow.
import { useState, type ReactNode } from "react";

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

// ────────── Switch3 ──────────
export function Switch3({ on, onChange }: { on: boolean; onChange?: (v: boolean) => void }) {
  const [v, setV] = useState(on);
  return (
    <button
      type="button"
      onClick={() => {
        const n = !v;
        setV(n);
        onChange?.(n);
      }}
      style={{
        width: 28,
        height: 16,
        borderRadius: 999,
        background: v ? "var(--foreground)" : "var(--border)",
        position: "relative",
        cursor: "pointer",
        border: 0,
        flexShrink: 0,
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 2,
          left: v ? 14 : 2,
          width: 12,
          height: 12,
          borderRadius: "50%",
          background: "var(--background)",
          transition: "left 140ms",
        }}
      />
    </button>
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
    <div className="os-row os-gap-3" style={{ padding: "10px 0", borderTop: "1px solid var(--border)" }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 500 }}>{label}</div>
        {sub && <div className="os-muted" style={{ fontSize: 11 }}>{sub}</div>}
      </div>
      <Switch3 on={on} onChange={setOn} />
    </div>
  );
}
