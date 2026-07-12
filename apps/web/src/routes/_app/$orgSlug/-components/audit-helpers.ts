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

/**
 * Color family for an action's leading dot, keyed off the action's verb —
 * actions are RPC paths (`<resource>.<verb>`, e.g. "projects.create",
 * "servers.setAvailability"), so the verb is the last dot-segment.
 *
 * Families follow the demo's ACTION_COLORS intent: creations read as info,
 * destructive verbs as danger, plain edits stay neutral, auth and
 * state-rewinding verbs (rollback/restore/pause) get caution amber.
 */
export type ActionTone = "create" | "destroy" | "update" | "auth" | "caution" | "neutral";

const TONE_VERBS: Array<[ActionTone, RegExp]> = [
  ["destroy", /^(delete|remove|revoke|destroy|disconnect|uninstall|teardown|purge|block|deny)/],
  // `rotate` rides with create — it mints a new credential (demo colors it info).
  ["create", /^(create|add|register|generate|connect|install|invite|grant|enable|import|upload|rotate)/],
  ["caution", /^(rollback|restore|pause|resume|redeploy|retry|recheck|cancel|stop|drain)/],
  ["auth", /^(login|logout|sign[-]?in|sign[-]?out|mfa|session|verify|impersonate|auth)/],
  ["update", /^(update|set|rename|edit|change|toggle|save|configure|move|reorder|assign|transfer)/],
];

export function actionTone(action: string): ActionTone {
  const verb = (action.split(".").pop() ?? action).toLowerCase();
  // Auth-plane actions carry the family in the resource segment ("auth.…",
  // "session.…") even when the verb itself is generic.
  if (/^(auth|session|mfa|login)\b/.test(action.toLowerCase())) return "auth";
  for (const [tone, re] of TONE_VERBS) if (re.test(verb)) return tone;
  return "neutral";
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
  const esc = (v: unknown) => {
    const s = v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
    return `"${s.replace(/"/g, '""')}"`;
  };
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
