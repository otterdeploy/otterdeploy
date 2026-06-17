/**
 * Display helpers and small form/badge primitives shared across the backups
 * feature. All formatters operate directly on the contract-inferred DTO types
 * (no parallel hand-written view models) — the page maps raw bytes/timestamps
 * into display strings here rather than into a duplicate interface.
 */
import {
  CloudServerIcon,
  DatabaseIcon,
  File01Icon,
  Folder01Icon,
  ServerStack01Icon,
  Upload01Icon,
} from "@hugeicons/core-free-icons";

import { Badge } from "@/shared/components/ui/badge";
import { cn } from "@/shared/lib/utils";

import type { Backup } from "./data/backups";
import type { Destination } from "./data/destinations";

// ────── DTO-derived unions ──────

export type BackupKind = Backup["kind"];
export type BackupStatus = Backup["status"];
export type DestinationKind = Destination["type"];
export type EncryptionValue = Backup["encryption"];

/** Sentinel for the "all projects" filter chip. */
export const ALL_PROJECTS = "__all__";

// ────── Formatters ──────

/** DB enum (`aes-256-gcm`) → the label the UI shows. */
export function encLabel(e: EncryptionValue): string {
  switch (e) {
    case "aes-256-gcm":
      return "AES-256 GCM";
    case "kms-managed":
      return "KMS-managed";
    case "customer-key":
      return "customer-key";
    default:
      return "none";
  }
}

export function relTime(d: Date | string | null): string {
  if (!d) return "—";
  const t = typeof d === "string" ? new Date(d).getTime() : d.getTime();
  const diff = Date.now() - t;
  if (!Number.isFinite(diff)) return "—";
  const future = diff < 0;
  const s = Math.max(0, Math.round(Math.abs(diff) / 1000));
  const fmt = (n: number, unit: string) =>
    future ? `in ${n}${unit}` : `${n}${unit} ago`;
  if (s < 60) return fmt(s, "s");
  const m = Math.round(s / 60);
  if (m < 60) return fmt(m, "m");
  const h = Math.round(m / 60);
  if (h < 24) return fmt(h, "h");
  return fmt(Math.round(h / 24), "d");
}

export function absTime(d: Date | string | null): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  return `${date.toISOString().slice(0, 19).replace("T", " ")} UTC`;
}

export function fmtDuration(ms: number | null): string {
  if (ms == null) return "—";
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}m ${String(s).padStart(2, "0")}s`;
}

export function fmtBytes(bytes: number | null): string {
  if (bytes == null || bytes <= 0) return "—";
  const mb = bytes / 1e6;
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  if (mb >= 1) return `${mb.toFixed(0)} MB`;
  return `${(mb * 1024).toFixed(0)} KB`;
}

/** When a run happened — the most specific timestamp it has reached. */
export function backupWhen(b: Backup): Date | string | null {
  return b.completedAt ?? b.startedAt ?? b.createdAt;
}

/** Trigger a browser download of a base64-encoded archive. */
export function downloadBase64(data: string, filename: string) {
  const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes]));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function cronHuman(cron: string): string {
  switch (cron) {
    case "0 * * * *":
      return "Every hour on the hour";
    case "0 3 * * *":
      return "Every day at 03:00 UTC";
    case "0 4 * * 0":
      return "Every Sunday at 04:00 UTC";
    case "0 2 1 * *":
      return "Monthly on the 1st at 02:00 UTC";
    default:
      return cron;
  }
}

/** Human retention summary from a schedule's GFS tiers + age/storage caps. */
export function retentionLabel(s: {
  keepDaily: number;
  keepWeekly: number;
  keepMonthly: number;
  keepYearly: number;
  retentionDays: number | null;
  maxStorageGb: number | null;
}): string {
  const tiers: string[] = [];
  if (s.keepDaily) tiers.push(`${s.keepDaily}d`);
  if (s.keepWeekly) tiers.push(`${s.keepWeekly}w`);
  if (s.keepMonthly) tiers.push(`${s.keepMonthly}mo`);
  if (s.keepYearly) tiers.push(`${s.keepYearly}y`);
  const parts: string[] = [];
  if (tiers.length) parts.push(`keep ${tiers.join("/")}`);
  if (s.retentionDays) parts.push(`${s.retentionDays}d max age`);
  if (s.maxStorageGb) parts.push(`${s.maxStorageGb}GB cap`);
  return parts.length ? parts.join(" · ") : "No retention policy";
}

// Config values are typed `unknown` (jsonb); coerce only scalars to a string.
function cfgStr(v: unknown): string {
  return typeof v === "string" || typeof v === "number" ? String(v) : "";
}

/** Short connection summary for a destination row. */
export function destUri(d: Destination): string {
  const cfg = d.config ?? {};
  if (d.type === "s3")
    return `s3://${cfgStr(cfg.bucket) || cfgStr(cfg.endpoint)}`;
  if (d.type === "local")
    return cfgStr(cfg.path) || "/var/backups/otterdeploy";
  return cfgStr(cfg.endpoint) || cfgStr(cfg.host);
}

export function destSub(d: Destination): string {
  const cfg = d.config ?? {};
  if (d.type === "s3") return cfgStr(cfg.region) || "S3-compatible";
  if (d.type === "local") return "Manager node";
  return "SFTP";
}

// ────── Icons / labels ──────

export function kindIcon(k: BackupKind) {
  if (k === "database") return DatabaseIcon;
  if (k === "volume") return Folder01Icon;
  return File01Icon;
}

export function destIcon(k: DestinationKind) {
  if (k === "s3") return CloudServerIcon;
  if (k === "sftp") return Upload01Icon;
  return ServerStack01Icon;
}

export function kindLabel(k: BackupKind): string {
  if (k === "database") return "DB";
  if (k === "volume") return "volume";
  return "stack";
}

// ────── Badges ──────

// Status tone → Tailwind classes.
function statusTone(status: BackupStatus | "active" | "degraded"): string {
  switch (status) {
    case "succeeded":
    case "active":
      return "border-emerald-500/30 bg-emerald-500/10 text-emerald-500";
    case "failed":
      return "border-rose-500/30 bg-rose-500/10 text-rose-500";
    case "running":
      return "border-blue-500/30 bg-blue-500/10 text-blue-500";
    case "degraded":
      return "border-amber-500/30 bg-amber-500/10 text-amber-500";
    default:
      return "text-muted-foreground";
  }
}

export function StatusBadge({
  status,
  children,
}: {
  status: BackupStatus | "active" | "degraded";
  children?: React.ReactNode;
}) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "gap-1.5 font-mono text-[10px] capitalize",
        statusTone(status),
      )}
    >
      <span className="size-1.5 rounded-full bg-current" />
      {children ?? status}
    </Badge>
  );
}

export function ProjectTagBadge({ id }: { id: string }) {
  return (
    <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
      {id}
    </span>
  );
}

// ────── Small form primitives ──────

export function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={cn("flex flex-col gap-1.5", className)}>
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

export function SectionH({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <h2 className="text-base font-semibold">{title}</h2>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: Array<{ id: T; label: string }>;
}) {
  return (
    <div className="inline-flex w-fit items-center gap-1 rounded-md border bg-muted/40 p-0.5">
      {options.map((o) => {
        const active = value === o.id;
        return (
          <button
            key={o.id}
            type="button"
            onClick={() => onChange(o.id)}
            className={cn(
              "rounded px-2.5 py-1 text-xs transition-colors",
              active
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
