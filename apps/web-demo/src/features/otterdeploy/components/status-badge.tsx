import type { ReactNode } from "react";

const map: Record<string, { cls: string; label: string }> = {
  healthy: { cls: "ok", label: "healthy" },
  degraded: { cls: "warn", label: "degraded" },
  down: { cls: "err", label: "down" },
  live: { cls: "ok", label: "live" },
  building: { cls: "info", label: "building" },
  failed: { cls: "err", label: "failed" },
  "rolled-back": { cls: "warn", label: "rolled back" },
  queued: { cls: "", label: "queued" },
  active: { cls: "ok", label: "active" },
};

export function StatusBadge({ status, children }: { status: string; children?: ReactNode }) {
  const m = map[status] ?? { cls: "", label: status };
  return (
    <span className={`badge ${m.cls}`}>
      <span className="dot" />
      {children ?? m.label}
    </span>
  );
}
