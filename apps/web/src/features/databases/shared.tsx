import { cn } from "@/shared/lib/utils";

/**
 * Formatters + small presentational atoms for the databases catalog. Values
 * that couldn't be measured render "—" — the page never invents a number.
 */
import type { CatalogDatabase } from "./data";

/** Sentinel for the "all projects" filter chip. */
export const ALL_PROJECTS = "__all__";

export function fmtBytes(bytes: number | null): string {
  if (bytes == null || bytes < 0) return "—";
  if (bytes < 1e6) return `${(bytes / 1e3).toFixed(bytes < 1e4 ? 1 : 0)} KB`;
  const mb = bytes / 1e6;
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${mb.toFixed(mb < 10 ? 1 : 0)} MB`;
}

export function relTime(iso: string | null): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(diff)) return "—";
  const s = Math.max(0, Math.round(diff / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

type RuntimeStatus = CatalogDatabase["runtimeStatus"];

const STATUS_TONE: Record<RuntimeStatus, { label: string; tone: string }> = {
  running: { label: "RUNNING", tone: "bg-success/12 text-success" },
  starting: { label: "STARTING", tone: "bg-warning/12 text-warning" },
  stopped: { label: "STOPPED", tone: "bg-muted text-muted-foreground" },
  missing: { label: "NOT DEPLOYED", tone: "bg-muted text-muted-foreground" },
  error: { label: "ERROR", tone: "bg-destructive/12 text-destructive" },
  unreachable: { label: "UNREACHABLE", tone: "bg-warning/12 text-warning" },
};

/** Same visual voice as the resource panel's runtime badge. */
export function StatusPill({ status }: { status: RuntimeStatus }) {
  const { label, tone } = STATUS_TONE[status];
  return (
    <span
      className={cn(
        "rounded-md px-2 py-1 font-mono text-[10.5px] font-semibold tracking-[0.18em] whitespace-nowrap",
        tone,
      )}
    >
      {label}
    </span>
  );
}

export function ProjectChip({ slug }: { slug: string }) {
  return (
    <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
      {slug}
    </span>
  );
}
