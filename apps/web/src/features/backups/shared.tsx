/**
 * Display helpers and small form/badge primitives shared across the backups
 * feature. All formatters operate directly on the contract-inferred DTO types
 * (no parallel hand-written view models): the page maps raw bytes/timestamps
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
  if (!d) return "–";
  const t = typeof d === "string" ? new Date(d).getTime() : d.getTime();
  const diff = Date.now() - t;
  if (!Number.isFinite(diff)) return "–";
  const future = diff < 0;
  const s = Math.max(0, Math.round(Math.abs(diff) / 1000));
  const fmt = (n: number, unit: string) => (future ? `in ${n}${unit}` : `${n}${unit} ago`);
  if (s < 60) return fmt(s, "s");
  const m = Math.round(s / 60);
  if (m < 60) return fmt(m, "m");
  const h = Math.round(m / 60);
  if (h < 24) return fmt(h, "h");
  return fmt(Math.round(h / 24), "d");
}

export function absTime(d: Date | string | null): string {
  if (!d) return "–";
  const date = typeof d === "string" ? new Date(d) : d;
  return `${date.toISOString().slice(0, 19).replace("T", " ")} UTC`;
}

export function fmtDuration(ms: number | null): string {
  if (ms == null) return "–";
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}m ${String(s).padStart(2, "0")}s`;
}

export function fmtBytes(bytes: number | null): string {
  if (bytes == null || bytes <= 0) return "–";
  const mb = bytes / 1e6;
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  if (mb >= 1) return `${mb.toFixed(0)} MB`;
  return `${(mb * 1024).toFixed(0)} KB`;
}

/** When a run happened. The most specific timestamp it has reached. */
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

// Config values are typed `unknown` (jsonb); coerce only scalars to a string.
function cfgStr(v: unknown): string {
  return typeof v === "string" || typeof v === "number" ? String(v) : "";
}

/** Short connection summary for a destination row. */
export function destUri(d: Destination): string {
  const cfg = d.config ?? {};
  if (d.type === "s3") return `s3://${cfgStr(cfg.bucket) || cfgStr(cfg.endpoint)}`;
  if (d.type === "local") return cfgStr(cfg.path) || "/var/backups/otterdeploy";
  if (d.type === "azblob") return `azblob://${cfgStr(cfg.container)}`;
  if (d.type === "gcs") return `gs://${cfgStr(cfg.bucket)}`;
  return cfgStr(cfg.endpoint) || cfgStr(cfg.host);
}

export function destSub(d: Destination): string {
  const cfg = d.config ?? {};
  if (d.type === "s3") return cfgStr(cfg.region) || "S3-compatible";
  if (d.type === "local") return "Manager node";
  if (d.type === "azblob") return "Azure Blob Storage";
  if (d.type === "gcs") return "Google Cloud Storage";
  return "SFTP";
}

// ────── Icons / labels ──────

export function kindIcon(k: BackupKind) {
  if (k === "database") return DatabaseIcon;
  if (k === "volume") return Folder01Icon;
  return File01Icon;
}

export function destIcon(k: DestinationKind) {
  if (k === "s3" || k === "azblob" || k === "gcs") return CloudServerIcon;
  if (k === "sftp") return Upload01Icon;
  return ServerStack01Icon;
}

export function kindLabel(k: BackupKind): string {
  if (k === "database") return "DB";
  if (k === "volume") return "volume";
  return "stack";
}

// ────── Badges ──────

// Status tone → the semantic state tokens (DESIGN.md §2). Not raw palette
// colours: `emerald-500` is one fixed value in both themes, while `--success`
// resolves to #1f7a3f on light and #4ade80 on dark, which is what keeps the
// contrast bar met in each.
function statusTone(status: BackupStatus | "active" | "degraded" | "disabled"): string {
  switch (status) {
    case "succeeded":
    case "active":
      return "border-success/30 bg-success/10 text-success";
    case "failed":
      return "border-destructive/30 bg-destructive/10 text-destructive";
    case "running":
      return "border-info/30 bg-info/10 text-info";
    case "degraded":
      return "border-warning/30 bg-warning/10 text-warning";
    // `disabled` falls through to muted on purpose: it's operator intent, not a
    // fault, so it must not compete visually with a real failure.
    default:
      return "text-muted-foreground";
  }
}

export function StatusBadge({
  status,
  children,
}: {
  status: BackupStatus | "active" | "degraded" | "disabled";
  children?: React.ReactNode;
}) {
  return (
    <Badge
      variant="outline"
      className={cn("gap-1.5 font-mono text-[10px] capitalize", statusTone(status))}
    >
      <span className="size-1.5 rounded-full bg-current" />
      {children ?? status}
    </Badge>
  );
}

/**
 * Restore-proving verification badge for a run. `passed` means the snapshot
 * was actually restored into a sandbox and inspected, so it earns a distinct
 * mark from plain run status. `none` renders nothing: absence of verification
 * is the default, not a warning.
 */
export function VerifiedBadge({ status }: { status: Backup["verifiedStatus"] }) {
  if (status === "none") return null;
  const tone =
    status === "passed"
      ? "border-success/30 bg-success/10 text-success"
      : status === "failed"
        ? "border-destructive/30 bg-destructive/10 text-destructive"
        : "border-info/30 bg-info/10 text-info";
  const label = status === "passed" ? "verified" : status === "failed" ? "verify failed" : "verifying";
  return (
    <Badge variant="outline" className={cn("gap-1 font-mono text-[10px]", tone)}>
      <span className="size-1.5 rounded-full bg-current" />
      {label}
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
