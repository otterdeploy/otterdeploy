// Form primitives ported from apps/web-demo/src/features/otterstack/components/form.tsx.
// Pass B extended with Switch3 and SettingRow.
// Change 4: Tailwind conversion.
import { useState, type ReactNode } from "react";

// ────────── SectionH ──────────
export function SectionH({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="mb-[10px] flex items-baseline gap-[10px]">
      <h3 className="m-0 text-[13px] font-semibold tracking-[0.01em]">{title}</h3>
      {sub && <span className="text-muted-foreground text-xs">{sub}</span>}
    </div>
  );
}

// ────────── Field ──────────
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-muted-foreground text-[11px]">{label}</span>
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
      className="relative cursor-pointer border-0 shrink-0 rounded-full"
      style={{
        width: 28,
        height: 16,
        background: v ? "var(--foreground)" : "var(--border)",
      }}
    >
      <span
        className="absolute top-0.5 w-3 h-3 rounded-full bg-background transition-[left] duration-[140ms]"
        style={{ left: v ? 14 : 2 }}
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
    <div className="flex items-center gap-3 py-[10px] border-t border-border">
      <div className="flex-1">
        <div className="text-[13px] font-medium">{label}</div>
        {sub && <div className="text-muted-foreground text-[11px]">{sub}</div>}
      </div>
      <Switch3 on={on} onChange={setOn} />
    </div>
  );
}
