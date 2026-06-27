import { useEffect, useState } from "react";

import type { AuditEvent } from "@/features/audit/data/audit";

/** Trailing-edge debounce — the input stays instant, the query waits a beat. */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

const RELATIVE_UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ["day", 86400],
  ["hour", 3600],
  ["minute", 60],
  ["second", 1],
];
const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

export function timeAgo(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "—";
  const diff = (t - Date.now()) / 1000;
  const abs = Math.abs(diff);
  for (const [unit, secs] of RELATIVE_UNITS) {
    if (abs >= secs || unit === "second") {
      return rtf.format(Math.round(diff / secs), unit);
    }
  }
  return "just now";
}

export function exportCsv(items: AuditEvent[]) {
  const cols: Array<keyof AuditEvent> = [
    "timestamp",
    "action",
    "actorType",
    "actorId",
    "actorEmail",
    "outcome",
    "targetType",
    "targetId",
    "ip",
    "durationMs",
    "reason",
  ];
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const rows = [
    cols.join(","),
    ...items.map((e) => cols.map((c) => esc(e[c])).join(",")),
  ];
  const blob = new Blob([rows.join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `audit-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
