/**
 * Backups — daily database dumps, weekly volume snapshots, stack manifest
 * history. Workspace-scoped (lives under the Infrastructure sidebar group,
 * same level as Servers / Networking). Ported from
 * apps/web-demo/src/features/otterdeploy/screens/backups.tsx, translated
 * from the demo's bespoke `os-*` CSS classes and inline styles onto
 * shadcn / Tailwind so the page reads in the same idiom as the rest of
 * apps/web (mirrors the Variables port).
 *
 * All data is currently mocked (matches the demo). Wiring to a real
 * backup / schedule / destination API is a follow-up.
 */

import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import {
  Alert02Icon,
  ArrowRight01Icon,
  CheckmarkCircle02Icon,
  Clock01Icon,
  CloudServerIcon,
  Delete02Icon,
  DatabaseIcon,
  Download01Icon,
  Edit02Icon,
  File01Icon,
  FlashIcon,
  Folder01Icon,
  PlusSignIcon,
  Refresh01Icon,
  Search01Icon,
  ServerStack01Icon,
  Settings01Icon,
  SquareLock01Icon,
  Tick02Icon,
  Upload01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import { Input } from "@/shared/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { Switch } from "@/shared/components/ui/switch";
import { cn } from "@/shared/lib/utils";
import { client, orpc, queryClient } from "@/shared/server/orpc";

// ────── API DTO shapes (inferred from the backups router) ──────
type BackupDTO = Awaited<ReturnType<typeof client.backups.list>>[number];
type ScheduleDTO = Awaited<
  ReturnType<typeof client.backups.schedules.list>
>[number];
type DestinationDTO = Awaited<
  ReturnType<typeof client.backups.destinations.list>
>[number];

export const Route = createFileRoute("/_app/$orgSlug/backups")({
  staticData: { crumb: "Backups" },
  component: BackupsRoute,
});

// ────── Types ──────

type BackupKind = "database" | "volume" | "stack";
type BackupStatus = "succeeded" | "failed" | "running" | "queued";
// Real destination ids are `bakdest_…`; kept as a plain string alias so the
// rest of the file reads the same as before the de-mock.
type DestinationId = string;
type DestinationKind = "s3" | "local" | "sftp";
type EncryptionMode = "AES-256 GCM" | "KMS-managed" | "customer-key" | "none";
type RetentionClass = "short" | "standard" | "long" | "archive";
type RestoreTarget = "in-place" | "as-new" | "download";

interface Backup {
  id: string;
  source: string;
  kind: BackupKind;
  /** Single-owner project id (each resource has one project). */
  project: string;
  when: string;
  whenAbs: string;
  duration: string;
  sizeMB: number;
  destination: DestinationId;
  destinationName: string;
  destinationKind: DestinationKind;
  encryption: EncryptionMode;
  status: BackupStatus;
  method: string;
  checksum: string;
  retention: RetentionClass;
  sourceSizeMB: number;
  compressedSizeMB: number;
  sourceService: string;
  sourceHost: string;
  log: string[];
  error?: string;
}

type CronPreset = "hourly" | "daily" | "weekly" | "monthly" | "custom";

interface Schedule {
  id: string;
  name: string;
  sources: string[];
  cron: string;
  cronHuman: string;
  retentionLabel: string;
  destination: DestinationId;
  destinationName: string;
  destinationKind: DestinationKind;
  encryption: EncryptionMode;
  pitr: boolean;
  enabled: boolean;
  lastRun: string;
  lastRunStatus: BackupStatus;
  nextRun: string;
}

interface Destination {
  id: DestinationId;
  name: string;
  uri: string;
  kind: DestinationKind;
  sub: string;
  usedGB: number;
  totalGB?: number;
  encryption: string;
  status: "active" | "degraded";
}

// ────── API → display mappers ──────

const ALL_PROJECTS = "__all__";

// DB enum (`aes-256-gcm`) → the label the UI shows.
function encLabel(e: BackupDTO["encryption"]): EncryptionMode {
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

function relTime(d: Date | string | null): string {
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

function absTime(d: Date | string | null): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  return `${date.toISOString().slice(0, 19).replace("T", " ")} UTC`;
}

function fmtDuration(ms: number | null): string {
  if (ms == null) return "—";
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}m ${String(s).padStart(2, "0")}s`;
}

// Config values are typed `unknown` (jsonb); coerce only scalars to a string.
function cfgStr(v: unknown): string {
  return typeof v === "string" || typeof v === "number" ? String(v) : "";
}

function destUri(d: DestinationDTO): string {
  const cfg = d.config ?? {};
  if (d.type === "s3")
    return `s3://${cfgStr(cfg.bucket) || cfgStr(cfg.endpoint)}`;
  if (d.type === "local") return cfgStr(cfg.path) || "/var/backups/otterdeploy";
  return cfgStr(cfg.endpoint) || cfgStr(cfg.host);
}

function mapBackup(b: BackupDTO): Backup {
  const when = b.completedAt ?? b.startedAt ?? b.createdAt;
  return {
    id: b.id,
    source: b.source ?? b.resourceId,
    kind: b.kind,
    project: b.project ?? "—",
    when: relTime(when),
    whenAbs: absTime(when),
    duration: fmtDuration(b.durationMs),
    sizeMB: (b.compressedSizeBytes ?? 0) / 1e6,
    destination: b.destinationId,
    destinationName: b.destinationName ?? "—",
    destinationKind: b.destinationType ?? "s3",
    encryption: encLabel(b.encryption),
    status: b.status,
    method: b.method ?? "",
    checksum: b.checksum ?? "—",
    retention: b.retention,
    sourceSizeMB: (b.sourceSizeBytes ?? 0) / 1e6,
    compressedSizeMB: (b.compressedSizeBytes ?? 0) / 1e6,
    sourceService: b.sourceService ?? "",
    sourceHost: b.sourceHost ?? "",
    log: [],
    error: b.errorMessage ?? undefined,
  };
}

function cronHuman(cron: string): string {
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

function retentionLabel(s: ScheduleDTO): string {
  const parts: string[] = [];
  if (s.keepDaily) parts.push(`${s.keepDaily} daily`);
  if (s.keepWeekly) parts.push(`${s.keepWeekly} weekly`);
  if (s.keepMonthly) parts.push(`${s.keepMonthly} monthly`);
  if (s.keepYearly) parts.push(`${s.keepYearly} yearly`);
  return parts.length ? `Keep ${parts.join(" + ")}` : "No retention policy";
}

function mapSchedule(s: ScheduleDTO): Schedule {
  return {
    id: s.id,
    name: s.name,
    sources: s.sources,
    cron: s.cron,
    cronHuman: cronHuman(s.cron),
    retentionLabel: retentionLabel(s),
    destination: s.destinationId,
    destinationName: s.destinationName ?? "—",
    destinationKind: "s3",
    encryption: encLabel(s.encryption),
    pitr: s.pitr,
    enabled: s.enabled,
    lastRun: relTime(s.lastRunAt),
    lastRunStatus: s.lastRunStatus ?? "queued",
    nextRun: s.nextRunAt ? relTime(s.nextRunAt) : "—",
  };
}

function mapDestination(d: DestinationDTO): Destination {
  const cfg = d.config ?? {};
  return {
    id: d.id,
    name: d.name,
    uri: destUri(d),
    kind: d.type,
    sub:
      d.type === "s3"
        ? cfgStr(cfg.region) || "S3-compatible"
        : d.type === "local"
          ? "Manager node"
          : "SFTP",
    usedGB: d.usedBytes / 1e9,
    totalGB: cfg.maxStorageGb ? Number(cfg.maxStorageGb) : undefined,
    encryption: "AES-256 GCM",
    status: d.status,
  };
}
// ────── Helpers ──────

function fmtSize(mb: number): string {
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  if (mb >= 1) return `${mb.toFixed(0)} MB`;
  if (mb > 0) return `${(mb * 1024).toFixed(0)} KB`;
  return "—";
}

function kindIcon(k: BackupKind) {
  if (k === "database") return DatabaseIcon;
  if (k === "volume") return Folder01Icon;
  return File01Icon;
}

function destIcon(k: DestinationKind) {
  if (k === "s3") return CloudServerIcon;
  if (k === "sftp") return Upload01Icon;
  return ServerStack01Icon;
}

function kindLabel(k: BackupKind): string {
  if (k === "database") return "DB";
  if (k === "volume") return "volume";
  return "stack";
}

function matchesProjectFilter(active: string, project: string): boolean {
  if (active === ALL_PROJECTS) return true;
  return project === active;
}

// Status tone → Tailwind classes (mirrors the Variables port's badge tones).
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

function StatusBadge({
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

function ProjectTagBadge({ id }: { id: string }) {
  return (
    <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
      {id}
    </span>
  );
}

// ────── Small form primitives (replace demo Field / SectionH) ──────

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function SectionH({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <h2 className="text-base font-semibold">{title}</h2>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: Array<{ id: T; label: string }>;
}) {
  return (
    <div className="inline-flex items-center gap-1 rounded-md border bg-muted/40 p-0.5">
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

// ────── Route ──────

function BackupsRoute() {
  // Live, org-scoped reads. Lists are empty until real backups/schedules/
  // destinations exist (no mock fallback). Filtering stays client-side over
  // the full list, exactly as the page did before the de-mock.
  const { data: backupDTOs = [] } = useQuery(
    orpc.backups.list.queryOptions({ input: {} }),
  );
  const { data: scheduleDTOs = [] } = useQuery(
    orpc.backups.schedules.list.queryOptions({ input: {} }),
  );
  const { data: destinationDTOs = [] } = useQuery(
    orpc.backups.destinations.list.queryOptions({ input: {} }),
  );

  const backups = useMemo(() => backupDTOs.map(mapBackup), [backupDTOs]);
  const schedules = useMemo(
    () => scheduleDTOs.map(mapSchedule),
    [scheduleDTOs],
  );
  const destinations = useMemo(
    () => destinationDTOs.map(mapDestination),
    [destinationDTOs],
  );

  const [projectFilter, setProjectFilter] = useState<string>(ALL_PROJECTS);
  const [kindFilter, setKindFilter] = useState<"all" | BackupKind>("all");
  // "all" sentinel + any destination id (DestinationId is a plain string).
  const [destFilter, setDestFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  const [backupNowOpen, setBackupNowOpen] = useState(false);
  const [scheduleEditor, setScheduleEditor] = useState<Schedule | "new" | null>(
    null,
  );
  const [restoreFor, setRestoreFor] = useState<Backup | null>(null);
  const [destEditor, setDestEditor] = useState<DestinationDTO | "new" | null>(
    null,
  );

  const invalidateDestinations = () => {
    void queryClient.invalidateQueries({
      queryKey: orpc.backups.destinations.list.key(),
    });
  };

  const deleteDestMut = useMutation({
    ...orpc.backups.destinations.delete.mutationOptions(),
    onSuccess: () => {
      invalidateDestinations();
      toast.success("Destination removed");
    },
    onError: (err) => toast.error(err.message ?? "Couldn't remove destination"),
  });

  const testDestMut = useMutation({
    ...orpc.backups.destinations.test.mutationOptions(),
    onSuccess: (res) => toast.success(res.message),
    onError: (err) => toast.error(err.message ?? "Test failed"),
  });

  // Project filter chips are derived from the backups actually present.
  const projects = useMemo(() => {
    const ids = Array.from(new Set(backups.map((b) => b.project))).filter(
      (id) => id && id !== "—",
    );
    return ids.sort();
  }, [backups]);

  const projectCounts = useMemo(() => {
    const out: Record<string, number> = {};
    for (const id of projects)
      out[id] = backups.filter((b) => b.project === id).length;
    return out;
  }, [backups, projects]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return backups.filter((b) => {
      if (!matchesProjectFilter(projectFilter, b.project)) return false;
      if (kindFilter !== "all" && b.kind !== kindFilter) return false;
      if (destFilter !== "all" && b.destination !== destFilter) return false;
      if (
        q &&
        !b.source.toLowerCase().includes(q) &&
        !b.id.toLowerCase().includes(q) &&
        !b.sourceHost.toLowerCase().includes(q)
      ) {
        return false;
      }
      return true;
    });
  }, [backups, projectFilter, kindFilter, destFilter, search]);

  const totalCount = backups.length;
  const totalSizeMB = backups
    .filter((b) => b.status === "succeeded")
    .reduce((acc, b) => acc + b.sizeMB, 0);
  const lastSuccess = backups.find((b) => b.status === "succeeded");
  const lastFail = backups.find((b) => b.status === "failed");

  // Backup deletion and schedule management land with the execution engine
  // (Phase 4) and the scheduler (Phase 5). Until then these are inert.
  const onDeleteBackup = (_id: string) =>
    toast.info("Deleting backups arrives with the execution engine.");
  const onToggleSchedule = (_id: string) =>
    toast.info("Schedule management arrives with the backup scheduler.");

  const allCount = Object.values(projectCounts).reduce((a, b) => a + b, 0);

  return (
    <div className="flex-1 overflow-auto p-6">
      <div className="mx-auto w-full max-w-6xl">
        {/* Header */}
        <div className="mb-5 flex items-start gap-2">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Backups</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Daily database dumps · weekly volume snapshots · stack manifest
              history
            </p>
          </div>
          <div className="flex-1" />
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => setScheduleEditor("new")}
          >
            <HugeiconsIcon icon={Clock01Icon} className="size-3.5" />
            Schedule
          </Button>
          <Button
            size="sm"
            className="gap-1.5"
            onClick={() => setBackupNowOpen(true)}
          >
            <HugeiconsIcon icon={Upload01Icon} className="size-3.5" />
            Backup now
          </Button>
        </div>

        {/* Stats */}
        <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat
            label="Total backups"
            value={String(totalCount)}
            sub={`${filtered.length} match filters`}
          />
          <Stat
            label="Stored size"
            value={fmtSize(totalSizeMB)}
            sub="across all destinations"
          />
          <Stat
            label="Last successful"
            value={lastSuccess?.when ?? "—"}
            sub={
              lastSuccess
                ? `${lastSuccess.source} · ${fmtSize(lastSuccess.sizeMB)}`
                : "no successful backup"
            }
          />
          <Stat
            label="Last failed"
            value={lastFail?.when ?? "none"}
            sub={
              lastFail
                ? `${lastFail.source} · ${lastFail.error?.slice(0, 38) ?? ""}…`
                : "no recent failures"
            }
            tone={lastFail ? "warn" : undefined}
          />
        </div>

        {/* Filters */}
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <div className="inline-flex items-center gap-1 rounded-md border bg-muted/40 p-0.5">
            <ProjectFilterButton
              active={projectFilter === ALL_PROJECTS}
              onClick={() => setProjectFilter(ALL_PROJECTS)}
              label="All projects"
              count={allCount}
            />
            {projects.map((id) => (
              <ProjectFilterButton
                key={id}
                active={projectFilter === id}
                onClick={() => setProjectFilter(id)}
                label={id}
                count={projectCounts[id] ?? 0}
              />
            ))}
          </div>

          <Segmented
            value={kindFilter}
            onChange={setKindFilter}
            options={[
              { id: "all", label: "All" },
              { id: "database", label: "Database" },
              { id: "volume", label: "Volume" },
              { id: "stack", label: "Stack" },
            ]}
          />

          <Select
            value={destFilter}
            onValueChange={(v) => setDestFilter(v as typeof destFilter)}
          >
            <SelectTrigger size="sm" className="w-44 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All destinations</SelectItem>
              {destinations.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="flex-1" />

          <div className="relative">
            <HugeiconsIcon
              icon={Search01Icon}
              className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search source, host, id…"
              className="h-8 w-64 pl-8 font-mono text-xs"
            />
          </div>
        </div>

        {/* Backup table */}
        <div className="mb-8 overflow-hidden rounded-md border bg-card">
          <div className="grid grid-cols-[2.4fr_1.2fr_1.1fr_80px_80px_1.1fr_120px_110px_120px] items-center gap-2 border-b bg-muted/30 px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            <span>Source</span>
            <span>Project</span>
            <span>When</span>
            <span>Duration</span>
            <span>Size</span>
            <span>Destination</span>
            <span>Encryption</span>
            <span>Status</span>
            <span />
          </div>

          {filtered.length === 0 && (
            <div className="px-3 py-6 text-center text-xs text-muted-foreground">
              No backups match these filters.
            </div>
          )}

          {filtered.map((b) => {
            const KIcon = kindIcon(b.kind);
            const DIcon = destIcon(b.destinationKind);
            const isExpanded = expanded === b.id;
            return (
              <div key={b.id} className="border-b last:border-b-0">
                <button
                  type="button"
                  className="grid w-full grid-cols-[2.4fr_1.2fr_1.1fr_80px_80px_1.1fr_120px_110px_120px] items-center gap-2 px-3 py-2 text-left hover:bg-muted/30"
                  onClick={() => setExpanded(isExpanded ? null : b.id)}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <HugeiconsIcon
                      icon={KIcon}
                      className="size-3.5 shrink-0 text-muted-foreground"
                    />
                    <span className="truncate font-mono text-xs font-medium">
                      {b.source}
                    </span>
                    <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                      {kindLabel(b.kind)}
                    </span>
                  </span>
                  <span>
                    <ProjectTagBadge id={b.project} />
                  </span>
                  <span
                    className="font-mono text-[11px] text-muted-foreground"
                    title={b.whenAbs}
                  >
                    {b.when}
                  </span>
                  <span className="font-mono text-[11px] text-foreground/80">
                    {b.duration}
                  </span>
                  <span className="font-mono text-[11px] text-foreground/80">
                    {fmtSize(b.sizeMB)}
                  </span>
                  <span className="flex min-w-0 items-center gap-1.5">
                    <HugeiconsIcon
                      icon={DIcon}
                      className="size-3 shrink-0 text-muted-foreground"
                    />
                    <span className="truncate font-mono text-[11px] text-foreground/80">
                      {b.destinationName}
                    </span>
                  </span>
                  <span>
                    {b.encryption !== "none" ? (
                      <span className="inline-flex items-center gap-1 rounded bg-emerald-500/10 px-1.5 py-0.5 font-mono text-[10px] text-emerald-500">
                        <HugeiconsIcon
                          icon={SquareLock01Icon}
                          className="size-2.5"
                        />
                        {b.encryption}
                      </span>
                    ) : (
                      <span className="font-mono text-[11px] text-muted-foreground">
                        —
                      </span>
                    )}
                  </span>
                  <span>
                    <StatusBadge status={b.status} />
                  </span>
                  <span
                    className="flex items-center justify-end gap-0.5"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-6"
                      title="Restore"
                      disabled={b.status !== "succeeded"}
                      onClick={() => setRestoreFor(b)}
                    >
                      <HugeiconsIcon icon={Refresh01Icon} className="size-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-6"
                      title="Download"
                      disabled={b.status !== "succeeded"}
                    >
                      <HugeiconsIcon icon={Download01Icon} className="size-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-6"
                      title="Delete"
                      onClick={() => onDeleteBackup(b.id)}
                    >
                      <HugeiconsIcon icon={Delete02Icon} className="size-3" />
                    </Button>
                    <HugeiconsIcon
                      icon={ArrowRight01Icon}
                      className={cn(
                        "ml-1 size-3 text-muted-foreground transition-transform",
                        isExpanded && "rotate-90",
                      )}
                    />
                  </span>
                </button>
                {isExpanded && <BackupDetail backup={b} />}
              </div>
            );
          })}

          <div className="flex items-center gap-1.5 border-t bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">
            <HugeiconsIcon icon={Folder01Icon} className="size-3" />
            <span>
              {filtered.length} of {totalCount} backup
              {totalCount === 1 ? "" : "s"}
            </span>
            <div className="flex-1" />
            <span className="font-mono">
              {fmtSize(filtered.reduce((acc, b) => acc + b.sizeMB, 0))} in view
            </span>
          </div>
        </div>

        {/* Schedules */}
        <div className="mb-3 flex items-center gap-2">
          <SectionH title="Schedules" sub="Recurring backup pipelines" />
          <div className="flex-1" />
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => setScheduleEditor("new")}
          >
            <HugeiconsIcon icon={PlusSignIcon} className="size-3.5" />
            New schedule
          </Button>
        </div>
        {schedules.length === 0 ? (
          <div className="mb-8 rounded-md border border-dashed bg-card px-4 py-8 text-center text-sm text-muted-foreground">
            No schedules yet. Create one to back up on a recurring cadence.
          </div>
        ) : (
          <div className="mb-8 grid grid-cols-1 gap-3 lg:grid-cols-2">
            {schedules.map((s) => (
              <ScheduleCard
                key={s.id}
                schedule={s}
                onToggle={() => onToggleSchedule(s.id)}
                onEdit={() => setScheduleEditor(s)}
              />
            ))}
          </div>
        )}

        {/* Destinations */}
        <div className="mb-3 flex items-center gap-2">
          <SectionH title="Destinations" sub="Where backups are written" />
          <div className="flex-1" />
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5"
            onClick={() => setDestEditor("new")}
          >
            <HugeiconsIcon icon={PlusSignIcon} className="size-3.5" />
            Add destination
          </Button>
        </div>
        <div className="mb-10 overflow-hidden rounded-md border bg-card">
          {destinations.length === 0 && (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              No destinations yet. Add one to start storing backups.
            </div>
          )}
          {destinations.map((d, i) => (
            <DestinationRow
              key={d.id}
              dest={d}
              first={i === 0}
              onEdit={() => {
                const dto = destinationDTOs.find((x) => x.id === d.id);
                if (dto) setDestEditor(dto);
              }}
              onTest={() => testDestMut.mutate({ id: d.id as never })}
              onDelete={() => deleteDestMut.mutate({ id: d.id as never })}
              testing={testDestMut.isPending}
            />
          ))}
        </div>
      </div>

      {/* Modals */}
      <BackupNowDialog
        open={backupNowOpen}
        onOpenChange={setBackupNowOpen}
        destinations={destinations}
      />
      <DestinationEditorDialog
        initial={destEditor === "new" ? null : destEditor}
        open={destEditor !== null}
        onOpenChange={(o) => !o && setDestEditor(null)}
        onSaved={invalidateDestinations}
      />
      <ScheduleEditorDialog
        initial={scheduleEditor === "new" ? null : scheduleEditor}
        open={scheduleEditor !== null}
        onOpenChange={(o) => !o && setScheduleEditor(null)}
        destinations={destinations}
      />
      <RestoreWizard
        backup={restoreFor}
        open={restoreFor !== null}
        onOpenChange={(o) => !o && setRestoreFor(null)}
        projects={projects}
      />
    </div>
  );
}

// ────── Stat ──────

function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub: string;
  tone?: "warn";
}) {
  return (
    <div className="flex flex-col gap-1 rounded-md border bg-card p-3.5">
      <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div
        className={cn(
          "text-2xl font-semibold tracking-tight",
          tone === "warn" && "font-mono text-amber-500",
        )}
      >
        {value}
      </div>
      <div className="text-xs text-muted-foreground">{sub}</div>
    </div>
  );
}

// ────── Project filter button ──────

function ProjectFilterButton({
  active,
  onClick,
  label,
  color,
  count,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  color?: string;
  count: number;
}) {
  const dim = !active && color !== undefined && count === 0;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs transition-colors",
        active
          ? "bg-background text-foreground shadow-sm"
          : dim
            ? "text-muted-foreground/50"
            : "text-muted-foreground hover:text-foreground",
      )}
    >
      {color && (
        <span
          className="size-1.5 rounded-full"
          style={{ background: color, opacity: dim ? 0.4 : 1 }}
        />
      )}
      <span>{label}</span>
      <span className="font-mono text-[10px] text-muted-foreground">
        {count}
      </span>
    </button>
  );
}

// ────── Backup detail (expanded row) ──────

function BackupDetail({ backup }: { backup: Backup }) {
  return (
    <div className="border-t bg-muted/30 px-4 py-3.5">
      <div className="mb-3 grid grid-cols-2 gap-3.5 lg:grid-cols-4">
        <DetailField label="Backup ID" value={backup.id} mono />
        <DetailField label="Method" value={backup.method} mono />
        <DetailField label="Retention class" value={backup.retention} />
        <DetailField
          label="Source service"
          value={`${backup.sourceService} @ ${backup.sourceHost}`}
          mono
        />
      </div>
      <div className="mb-3 grid grid-cols-3 gap-3.5">
        <DetailField
          label="Source size"
          value={fmtSize(backup.sourceSizeMB)}
          mono
        />
        <DetailField
          label="Compressed"
          value={fmtSize(backup.compressedSizeMB)}
          mono
        />
        <DetailField
          label="Compression ratio"
          value={
            backup.sourceSizeMB > 0 && backup.compressedSizeMB > 0
              ? `${((1 - backup.compressedSizeMB / backup.sourceSizeMB) * 100).toFixed(0)}%`
              : "—"
          }
          mono
        />
      </div>

      <div className="mb-3 flex flex-col gap-1">
        <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          Checksum
        </span>
        <code className="break-all rounded border bg-background px-2 py-1.5 font-mono text-[11px] text-foreground/80">
          {backup.checksum}
        </code>
      </div>

      {backup.error && (
        <div className="mb-3 flex gap-2 rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-2">
          <HugeiconsIcon
            icon={Alert02Icon}
            className="mt-0.5 size-3.5 shrink-0 text-rose-500"
          />
          <div className="font-mono text-[11px] text-rose-500">
            {backup.error}
          </div>
        </div>
      )}

      <div className="flex flex-col gap-1">
        <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          Log preview · last {backup.log.length} lines
        </span>
        <div className="max-h-40 overflow-auto rounded-md border bg-background p-2.5 font-mono text-[11px] leading-relaxed">
          {backup.log.map((l, i) => (
            <div
              key={i}
              className={cn(
                "text-foreground/80",
                l.includes("[err]") && "text-rose-500",
                l.includes("[warn]") && "text-amber-500",
                l.includes("[ok]") && "text-emerald-500",
              )}
            >
              {l}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function DetailField({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <span
        className={cn(
          "break-words text-xs text-foreground/80",
          mono && "font-mono",
        )}
      >
        {value}
      </span>
    </div>
  );
}

// ────── Schedule card ──────

function ScheduleCard({
  schedule,
  onToggle,
  onEdit,
}: {
  schedule: Schedule;
  onToggle: () => void;
  onEdit: () => void;
}) {
  const DIcon = destIcon(schedule.destinationKind);
  return (
    <div className="flex flex-col gap-3 rounded-md border bg-card p-4">
      <div className="flex items-center gap-2">
        <HugeiconsIcon
          icon={Clock01Icon}
          className="size-3.5 text-muted-foreground"
        />
        <span className="text-sm font-semibold">{schedule.name}</span>
        <div className="flex-1" />
        <Switch checked={schedule.enabled} onCheckedChange={onToggle} />
      </div>
      <p className="text-[11px] text-muted-foreground">
        {schedule.sources.length} source
        {schedule.sources.length === 1 ? "" : "s"} ·{" "}
        <span className="font-mono">
          {schedule.sources.slice(0, 3).join(", ")}
        </span>
        {schedule.sources.length > 3 && (
          <span> +{schedule.sources.length - 3}</span>
        )}
      </p>

      <div className="rounded-md border bg-muted/30 px-2.5 py-2">
        <div className="font-mono text-xs">{schedule.cron}</div>
        <div className="mt-0.5 text-[11px] text-muted-foreground">
          {schedule.cronHuman}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2.5">
        <div className="flex flex-col gap-0.5">
          <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Retention
          </span>
          <span className="text-xs text-foreground/80">
            {schedule.retentionLabel}
          </span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Destination
          </span>
          <span className="flex items-center gap-1 text-xs text-foreground/80">
            <HugeiconsIcon
              icon={DIcon}
              className="size-3 text-muted-foreground"
            />
            <span className="font-mono">{schedule.destinationName}</span>
          </span>
        </div>
      </div>

      <div className="flex items-end gap-4 border-t pt-3">
        <div className="flex flex-col gap-0.5">
          <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Last run
          </span>
          <span className="flex items-center gap-1.5">
            <StatusBadge status={schedule.lastRunStatus} />
            <span className="font-mono text-[11px] text-muted-foreground">
              {schedule.lastRun}
            </span>
          </span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Next run
          </span>
          <span className="font-mono text-xs text-foreground/80">
            {schedule.nextRun}
          </span>
        </div>
        <div className="flex-1" />
        {schedule.pitr && (
          <Badge
            variant="outline"
            className="border-blue-500/30 bg-blue-500/10 text-[10px] text-blue-500"
            title="Point-in-time recovery enabled"
          >
            PITR
          </Badge>
        )}
        {schedule.encryption !== "none" && (
          <Badge variant="secondary" className="gap-1 text-[10px]">
            <HugeiconsIcon icon={SquareLock01Icon} className="size-2.5" />
            {schedule.encryption}
          </Badge>
        )}
      </div>

      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={onEdit}
        >
          <HugeiconsIcon icon={Edit02Icon} className="size-3" />
          Edit
        </Button>
        <Button variant="outline" size="sm" className="gap-1.5">
          <HugeiconsIcon icon={FlashIcon} className="size-3" />
          Run now
        </Button>
      </div>
    </div>
  );
}

// ────── Destination row ──────

function DestinationRow({
  dest,
  first,
  onEdit,
  onTest,
  onDelete,
  testing,
}: {
  dest: Destination;
  first: boolean;
  onEdit: () => void;
  onTest: () => void;
  onDelete: () => void;
  testing: boolean;
}) {
  const DIcon = destIcon(dest.kind);
  const pct = dest.totalGB ? (dest.usedGB / dest.totalGB) * 100 : null;
  return (
    <div
      className={cn(
        "flex items-center gap-3 px-4 py-3.5",
        !first && "border-t",
      )}
    >
      <div className="grid size-8 place-items-center rounded-md border bg-muted/30 text-muted-foreground">
        <HugeiconsIcon icon={DIcon} className="size-3.5" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">{dest.name}</span>
          <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
            {dest.uri}
          </span>
        </div>
        <div className="text-[11px] text-muted-foreground">
          {dest.sub} · encryption: {dest.encryption}
        </div>
      </div>
      <div className="flex min-w-40 flex-col items-end gap-0.5">
        <span className="font-mono text-xs">
          {dest.usedGB} GB
          {dest.totalGB ? (
            <span className="text-muted-foreground"> / {dest.totalGB} GB</span>
          ) : null}
        </span>
        {pct != null && (
          <div className="mt-1 h-1 w-36 rounded-full bg-muted">
            <div
              className={cn(
                "h-full rounded-full",
                pct > 80 ? "bg-amber-500" : "bg-foreground/60",
              )}
              style={{ width: `${pct}%` }}
            />
          </div>
        )}
      </div>
      <StatusBadge status={dest.status} />
      <Button
        variant="ghost"
        size="sm"
        className="gap-1.5"
        title="Validate stored credential"
        disabled={testing}
        onClick={onTest}
      >
        <HugeiconsIcon icon={Tick02Icon} className="size-3.5" />
        Test
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="size-7"
        title="Edit"
        onClick={onEdit}
      >
        <HugeiconsIcon icon={Settings01Icon} className="size-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="size-7"
        title="Delete"
        onClick={onDelete}
      >
        <HugeiconsIcon icon={Delete02Icon} className="size-3.5" />
      </Button>
    </div>
  );
}

// ────── Destination editor dialog ──────

const DEST_TYPE_FIELDS: Record<
  DestinationKind,
  { config: { key: string; label: string; placeholder?: string }[]; secret: { key: string; label: string }[] }
> = {
  s3: {
    config: [
      { key: "bucket", label: "Bucket" },
      { key: "region", label: "Region", placeholder: "us-east-1" },
      { key: "endpoint", label: "Endpoint (optional)", placeholder: "https://s3.example.com" },
      { key: "prefix", label: "Prefix (optional)", placeholder: "backups/" },
    ],
    secret: [
      { key: "accessKeyId", label: "Access key ID" },
      { key: "secretAccessKey", label: "Secret access key" },
    ],
  },
  local: {
    config: [{ key: "path", label: "Path", placeholder: "/var/backups/otterdeploy" }],
    secret: [],
  },
  sftp: {
    config: [
      { key: "host", label: "Host" },
      { key: "port", label: "Port", placeholder: "22" },
      { key: "username", label: "Username" },
      { key: "path", label: "Remote path", placeholder: "/backups" },
    ],
    secret: [{ key: "password", label: "Password" }],
  },
};

function DestinationEditorDialog({
  initial,
  open,
  onOpenChange,
  onSaved,
}: {
  initial: DestinationDTO | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  if (!open) return null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DestinationEditorBody
        initial={initial}
        onClose={() => onOpenChange(false)}
        onSaved={onSaved}
      />
    </Dialog>
  );
}

function DestinationEditorBody({
  initial,
  onClose,
  onSaved,
}: {
  initial: DestinationDTO | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const editing = initial !== null;
  const [name, setName] = useState(initial?.name ?? "");
  const [type, setType] = useState<DestinationKind>(initial?.type ?? "s3");
  const [config, setConfig] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    const cfg = initial?.config ?? {};
    for (const f of DEST_TYPE_FIELDS[initial?.type ?? "s3"].config) {
      const v = (cfg as Record<string, unknown>)[f.key];
      out[f.key] = typeof v === "string" || typeof v === "number" ? String(v) : "";
    }
    return out;
  });
  const [secret, setSecret] = useState<Record<string, string>>({});

  const fields = DEST_TYPE_FIELDS[type];

  const createMut = useMutation({
    ...orpc.backups.destinations.create.mutationOptions(),
    onSuccess: () => {
      onSaved();
      onClose();
      toast.success("Destination created");
    },
    onError: (err) => toast.error(err.message ?? "Couldn't create destination"),
  });
  const updateMut = useMutation({
    ...orpc.backups.destinations.update.mutationOptions(),
    onSuccess: () => {
      onSaved();
      onClose();
      toast.success("Destination updated");
    },
    onError: (err) => toast.error(err.message ?? "Couldn't update destination"),
  });

  const saving = createMut.isPending || updateMut.isPending;

  const submit = () => {
    // Drop empty config keys; only send a secret if any field was filled.
    const cleanConfig: Record<string, string> = {};
    for (const f of fields.config) {
      const v = config[f.key]?.trim();
      if (v) cleanConfig[f.key] = v;
    }
    const cleanSecret: Record<string, string> = {};
    for (const f of fields.secret) {
      const v = secret[f.key]?.trim();
      if (v) cleanSecret[f.key] = v;
    }
    const hasSecret = Object.keys(cleanSecret).length > 0;

    if (editing && initial) {
      updateMut.mutate({
        id: initial.id as never,
        name: name.trim() || undefined,
        config: cleanConfig,
        secret: hasSecret ? cleanSecret : undefined,
      });
    } else {
      createMut.mutate({
        name: name.trim(),
        type,
        config: cleanConfig,
        secret: hasSecret ? cleanSecret : undefined,
      } as never);
    }
  };

  return (
    <DialogContent className="max-w-2xl gap-0 p-0">
      <DialogHeader className="border-b px-5 py-3">
        <DialogTitle className="text-sm font-semibold">
          {editing ? "Edit destination" : "Add destination"}
        </DialogTitle>
        <p className="text-xs text-muted-foreground">
          Where backups are written. Credentials are encrypted at rest.
        </p>
      </DialogHeader>

      <div className="flex flex-col gap-4 p-5">
        <Field label="Name">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="S3 · primary"
          />
        </Field>
        {!editing && (
          <Field label="Type">
            <Segmented
              value={type}
              onChange={(t) => {
                setType(t);
                setConfig({});
                setSecret({});
              }}
              options={[
                { id: "s3", label: "S3" },
                { id: "local", label: "Local disk" },
                { id: "sftp", label: "SFTP" },
              ]}
            />
          </Field>
        )}
        {fields.config.map((f) => (
          <Field key={f.key} label={f.label}>
            <Input
              value={config[f.key] ?? ""}
              placeholder={f.placeholder}
              onChange={(e) =>
                setConfig((c) => ({ ...c, [f.key]: e.target.value }))
              }
            />
          </Field>
        ))}
        {fields.secret.length > 0 && (
          <div className="flex flex-col gap-3 rounded-md border bg-muted/30 p-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <HugeiconsIcon icon={SquareLock01Icon} className="size-3.5" />
              {editing
                ? "Leave blank to keep the stored credential"
                : "Encrypted at rest (AES-256 GCM)"}
            </div>
            {fields.secret.map((f) => (
              <Field key={f.key} label={f.label}>
                <Input
                  type="password"
                  value={secret[f.key] ?? ""}
                  onChange={(e) =>
                    setSecret((s) => ({ ...s, [f.key]: e.target.value }))
                  }
                />
              </Field>
            ))}
          </div>
        )}
      </div>

      <div className="flex items-center justify-end gap-2 border-t px-5 py-3">
        <Button variant="outline" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button
          size="sm"
          disabled={saving || !name.trim()}
          onClick={submit}
        >
          {saving ? "Saving…" : editing ? "Save changes" : "Create destination"}
        </Button>
      </div>
    </DialogContent>
  );
}

// ────── Backup-now dialog ──────

function BackupNowDialog({
  open,
  onOpenChange,
  destinations,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  destinations: Destination[];
}) {
  const [kind, setKind] = useState<BackupKind>("database");
  const [source, setSource] = useState("postgres");
  const [destination, setDestination] = useState<DestinationId>("");
  const [encrypted, setEncrypted] = useState(true);
  const [starting, setStarting] = useState(false);

  const sourcesByKind: Record<BackupKind, string[]> = {
    database: ["postgres", "billing-pg", "redis"],
    volume: ["web-uploads", "postgres-data", "marketing-assets"],
    stack: ["stack.yml", "marketing/stack.yml"],
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl gap-0 p-0">
        <DialogHeader className="border-b px-5 py-3">
          <DialogTitle className="text-sm font-semibold">
            Run a backup now
          </DialogTitle>
          <p className="text-xs text-muted-foreground">
            Choose what to back up. Runs out-of-band from the schedule.
          </p>
        </DialogHeader>

        <div className="flex flex-col gap-4 p-5">
          <Field label="Backup kind">
            <Segmented
              value={kind}
              onChange={(nk) => {
                setKind(nk);
                setSource(sourcesByKind[nk][0]);
              }}
              options={[
                { id: "database", label: "Database" },
                { id: "volume", label: "Volume" },
                { id: "stack", label: "Stack" },
              ]}
            />
          </Field>
          <Field label="Source">
            <Select value={source} onValueChange={(v) => v && setSource(v)}>
              <SelectTrigger className="font-mono">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {sourcesByKind[kind].map((s) => (
                  <SelectItem key={s} value={s} className="font-mono">
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Destination">
            <Select
              value={destination}
              onValueChange={(v) => setDestination(v as DestinationId)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select a destination" />
              </SelectTrigger>
              <SelectContent>
                {destinations.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.name} — {d.uri}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <div className="flex items-center gap-3 rounded-md border bg-muted/30 px-3 py-2.5">
            <HugeiconsIcon
              icon={SquareLock01Icon}
              className="size-3.5 text-muted-foreground"
            />
            <div className="flex flex-1 flex-col">
              <span className="text-xs font-medium">Encrypt at rest</span>
              <span className="text-[11px] text-muted-foreground">
                AES-256 GCM · key managed by destination policy
              </span>
            </div>
            <Switch checked={encrypted} onCheckedChange={setEncrypted} />
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t px-5 py-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            className="gap-1.5"
            disabled={starting}
            onClick={() => {
              setStarting(true);
              setTimeout(() => {
                setStarting(false);
                onOpenChange(false);
              }, 800);
            }}
          >
            <HugeiconsIcon icon={FlashIcon} className="size-3" />
            {starting ? "Starting…" : "Start backup"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ────── Schedule editor dialog ──────

function ScheduleEditorDialog({
  initial,
  open,
  onOpenChange,
  destinations,
}: {
  initial: Schedule | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  destinations: Destination[];
}) {
  if (!open) return null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <ScheduleEditorBody
        initial={initial}
        onClose={() => onOpenChange(false)}
        destinations={destinations}
      />
    </Dialog>
  );
}

function ScheduleEditorBody({
  initial,
  onClose,
  destinations,
}: {
  initial: Schedule | null;
  onClose: () => void;
  destinations: Destination[];
}) {
  const [name, setName] = useState(initial?.name ?? "New backup schedule");
  const [sourcesText, setSourcesText] = useState(
    (initial?.sources ?? ["postgres"]).join(", "),
  );
  const [preset, setPreset] = useState<CronPreset>(
    initial?.cron === "0 * * * *"
      ? "hourly"
      : initial?.cron === "0 3 * * *"
        ? "daily"
        : initial?.cron === "0 4 * * 0"
          ? "weekly"
          : initial?.cron === "0 2 1 * *"
            ? "monthly"
            : "custom",
  );
  const [cron, setCron] = useState(initial?.cron ?? "0 3 * * *");
  const [keepDaily, setKeepDaily] = useState(14);
  const [keepWeekly, setKeepWeekly] = useState(4);
  const [keepMonthly, setKeepMonthly] = useState(6);
  const [keepYearly, setKeepYearly] = useState(0);
  const [destination, setDestination] = useState<DestinationId>(
    initial?.destination ?? "",
  );
  const [encryption, setEncryption] = useState<EncryptionMode>(
    initial?.encryption ?? "AES-256 GCM",
  );
  const [hook, setHook] = useState("");
  const [notify, setNotify] = useState("ops-alerts");

  const presetCron = (p: CronPreset): string => {
    switch (p) {
      case "hourly":
        return "0 * * * *";
      case "daily":
        return "0 3 * * *";
      case "weekly":
        return "0 4 * * 0";
      case "monthly":
        return "0 2 1 * *";
      default:
        return cron;
    }
  };

  return (
    <DialogContent className="max-w-2xl gap-0 p-0">
      <DialogHeader className="border-b px-5 py-3">
        <DialogTitle className="text-sm font-semibold">
          {initial ? `Edit schedule · ${initial.name}` : "New backup schedule"}
        </DialogTitle>
        <p className="text-xs text-muted-foreground">
          Cron-driven pipeline that runs even when the dashboard is closed.
        </p>
      </DialogHeader>

      <div className="flex max-h-[70vh] flex-col gap-4 overflow-auto p-5">
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>

        <Field label="Sources (comma-separated service / volume / manifest names)">
          <Input
            className="font-mono"
            value={sourcesText}
            onChange={(e) => setSourcesText(e.target.value)}
          />
        </Field>

        <div className="flex flex-col gap-1.5">
          <span className="text-xs text-muted-foreground">Cron preset</span>
          <Segmented
            value={preset}
            onChange={(np) => {
              setPreset(np);
              if (np !== "custom") setCron(presetCron(np));
            }}
            options={[
              { id: "hourly", label: "Hourly" },
              { id: "daily", label: "Daily" },
              { id: "weekly", label: "Weekly" },
              { id: "monthly", label: "Monthly" },
              { id: "custom", label: "Custom" },
            ]}
          />
        </div>

        <Field label="Cron expression">
          <Input
            className="font-mono"
            value={cron}
            onChange={(e) => {
              setCron(e.target.value);
              setPreset("custom");
            }}
          />
        </Field>

        <div className="flex flex-col gap-2">
          <span className="text-xs text-muted-foreground">Retention rules</span>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            <Field label="Keep daily">
              <Input
                className="font-mono"
                type="number"
                min={0}
                value={keepDaily}
                onChange={(e) => setKeepDaily(Number(e.target.value))}
              />
            </Field>
            <Field label="Keep weekly">
              <Input
                className="font-mono"
                type="number"
                min={0}
                value={keepWeekly}
                onChange={(e) => setKeepWeekly(Number(e.target.value))}
              />
            </Field>
            <Field label="Keep monthly">
              <Input
                className="font-mono"
                type="number"
                min={0}
                value={keepMonthly}
                onChange={(e) => setKeepMonthly(Number(e.target.value))}
              />
            </Field>
            <Field label="Keep yearly">
              <Input
                className="font-mono"
                type="number"
                min={0}
                value={keepYearly}
                onChange={(e) => setKeepYearly(Number(e.target.value))}
              />
            </Field>
          </div>
          <div className="font-mono text-[11px] text-muted-foreground">
            forget-policy: keep last {keepDaily} daily, {keepWeekly} weekly,{" "}
            {keepMonthly} monthly, {keepYearly} yearly
          </div>
        </div>

        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          <Field label="Destination">
            <Select
              value={destination}
              onValueChange={(v) => setDestination(v as DestinationId)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select a destination" />
              </SelectTrigger>
              <SelectContent>
                {destinations.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Encryption">
            <Select
              value={encryption}
              onValueChange={(v) => setEncryption(v as EncryptionMode)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="KMS-managed">KMS-managed</SelectItem>
                <SelectItem value="AES-256 GCM">AES-256 GCM</SelectItem>
                <SelectItem value="customer-key">
                  Customer-managed key
                </SelectItem>
                <SelectItem value="none">None (not recommended)</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </div>

        <Field label="Pre-backup hook (optional)">
          <Input
            className="font-mono"
            placeholder="e.g. systemctl stop postgres-prewarm"
            value={hook}
            onChange={(e) => setHook(e.target.value)}
          />
        </Field>

        <Field label="Notification channel">
          <Select value={notify} onValueChange={(v) => v && setNotify(v)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ops-alerts">#ops-alerts (Slack)</SelectItem>
              <SelectItem value="email-admins">
                email · admins@paperhouse.dev
              </SelectItem>
              <SelectItem value="webhook">Webhook · ops-router</SelectItem>
              <SelectItem value="none">No notifications</SelectItem>
            </SelectContent>
          </Select>
        </Field>
      </div>

      <div className="flex items-center justify-end gap-2 border-t px-5 py-3">
        <Button variant="outline" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button size="sm" className="gap-1.5" onClick={onClose}>
          <HugeiconsIcon icon={Tick02Icon} className="size-3" />
          Save schedule
        </Button>
      </div>
    </DialogContent>
  );
}

// ────── Restore wizard ──────

function RestoreWizard({
  backup,
  open,
  onOpenChange,
  projects,
}: {
  backup: Backup | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projects: string[];
}) {
  if (!open || !backup) return null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <RestoreWizardBody
        backup={backup}
        onClose={() => onOpenChange(false)}
        projects={projects}
      />
    </Dialog>
  );
}

function RestoreWizardBody({
  backup,
  onClose,
  projects,
}: {
  backup: Backup;
  onClose: () => void;
  projects: string[];
}) {
  const [step, setStep] = useState<0 | 1 | 2>(0);
  const [target, setTarget] = useState<RestoreTarget>("as-new");
  const [newName, setNewName] = useState(`${backup.source}-restored`);
  const [newProject, setNewProject] = useState<string>(backup.project);
  const [confirm, setConfirm] = useState("");

  const requiresTyped = target === "in-place";
  const typedOk = !requiresTyped || confirm === backup.source;

  return (
    <DialogContent className="max-w-3xl gap-0 p-0">
      <DialogHeader className="border-b px-5 py-3">
        <DialogTitle className="text-sm font-semibold">
          Restore · {backup.source}
        </DialogTitle>
        <p className="text-xs text-muted-foreground">
          Backup {backup.id} · {backup.whenAbs}
        </p>
      </DialogHeader>

      <div className="flex flex-col gap-4 p-5">
        {/* Step indicator */}
        <div className="flex items-center gap-1">
          {(["Choose target", "Verify", "Confirm"] as const).map((s, i) => (
            <div key={s} className="flex flex-1 items-center gap-2">
              <span
                className={cn(
                  "grid size-[22px] place-items-center rounded-full text-[11px] font-semibold",
                  i <= step
                    ? "bg-foreground text-background"
                    : "bg-muted text-muted-foreground",
                )}
              >
                {i + 1}
              </span>
              <span
                className={cn(
                  "text-xs",
                  i === step ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {s}
              </span>
              {i < 2 && <div className="h-px flex-1 bg-border" />}
            </div>
          ))}
        </div>

        {step === 0 && (
          <div className="flex flex-col gap-3">
            <RestoreTargetCard
              id="in-place"
              current={target}
              onSelect={setTarget}
              danger
              title="Restore in place"
              sub="Overwrites the current source. Requires typed-name confirmation. Use only when the source is unrecoverable."
            />
            <RestoreTargetCard
              id="as-new"
              current={target}
              onSelect={setTarget}
              title="Restore as new"
              sub="Provision a new service / volume from this snapshot under a new name. Safe."
            />
            <RestoreTargetCard
              id="download"
              current={target}
              onSelect={setTarget}
              title="Download only"
              sub="Generate a presigned URL and let me handle the rest."
            />
            {target === "as-new" && (
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                <Field label="New name">
                  <Input
                    className="font-mono"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                  />
                </Field>
                <Field label="Project">
                  <Select
                    value={newProject}
                    onValueChange={(v) => v && setNewProject(v)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {projects.map((id) => (
                        <SelectItem key={id} value={id}>
                          {id}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              </div>
            )}
          </div>
        )}

        {step === 1 && (
          <div className="flex flex-col gap-3">
            <p className="text-xs text-muted-foreground">
              Verify the snapshot integrity and review the source ↔ target diff
              before continuing.
            </p>
            <div className="rounded-md border bg-muted/30 p-3">
              <div className="mb-2 flex items-center gap-2">
                <span className="text-xs font-semibold">Integrity check</span>
                <div className="flex-1" />
                <StatusBadge status="succeeded">checksum match</StatusBadge>
              </div>
              <div className="font-mono text-[11px] text-muted-foreground">
                sha256 ok · {backup.checksum.slice(0, 24)}…
              </div>
              <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                encryption: {backup.encryption}
              </div>
            </div>

            <div className="overflow-hidden rounded-md border">
              <div className="border-b bg-muted/30 px-3 py-2">
                <span className="text-xs font-semibold">
                  Source ↔ target diff
                </span>
              </div>
              <div className="p-3 font-mono text-[11px] leading-relaxed">
                <div className="text-muted-foreground">
                  --- source: {backup.sourceService}
                </div>
                <div className="text-muted-foreground">
                  +++ target:{" "}
                  {target === "in-place"
                    ? backup.source
                    : target === "as-new"
                      ? newName
                      : "(download only)"}
                </div>
                <div className="text-emerald-500">
                  + size: {fmtSize(backup.sourceSizeMB)}
                </div>
                <div className="text-emerald-500">
                  + method: {backup.method}
                </div>
                <div className="text-amber-500">
                  ~ retention class: {backup.retention}
                </div>
                {target === "in-place" && (
                  <div className="text-rose-500">
                    - existing data on {backup.source} will be replaced
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="flex flex-col gap-3">
            {target === "download" && (
              <div className="rounded-md border border-blue-500/30 bg-blue-500/10 p-3.5">
                <div className="mb-1.5 flex items-center gap-2">
                  <HugeiconsIcon
                    icon={Download01Icon}
                    className="size-3.5 text-blue-500"
                  />
                  <span className="text-sm font-semibold text-blue-500">
                    Download presigned URL
                  </span>
                </div>
                <code className="block break-all rounded bg-background p-2 font-mono text-[11px] text-foreground/80">
                  https://helio-backups.local/{backup.id}
                  .tgz?X-Amz-Expires=3600&X-Amz-Signature=…
                </code>
                <p className="mt-1.5 text-[11px] text-muted-foreground">
                  URL is valid for 60 minutes. We will not record this download
                  against retention.
                </p>
              </div>
            )}
            {target === "as-new" && (
              <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3.5">
                <div className="mb-1 flex items-center gap-2">
                  <HugeiconsIcon
                    icon={CheckmarkCircle02Icon}
                    className="size-3.5 text-emerald-500"
                  />
                  <span className="text-sm font-semibold text-emerald-500">
                    Safe restore
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  A new service named{" "}
                  <span className="font-mono">{newName}</span> will be created
                  in project <b>{newProject}</b>. Nothing existing will change.
                </p>
              </div>
            )}
            {target === "in-place" && (
              <>
                <div className="rounded-md border border-rose-500/35 bg-rose-500/10 p-3.5">
                  <div className="mb-1.5 flex items-center gap-2">
                    <HugeiconsIcon
                      icon={Alert02Icon}
                      className="size-3.5 text-rose-500"
                    />
                    <span className="text-sm font-semibold text-rose-500">
                      Destructive action
                    </span>
                  </div>
                  <p className="text-xs text-foreground/80">
                    This will overwrite all current data on{" "}
                    <span className="font-mono text-rose-500">
                      {backup.source}
                    </span>{" "}
                    with snapshot <span className="font-mono">{backup.id}</span>
                    . The current state cannot be recovered unless a separate
                    snapshot exists.
                  </p>
                </div>
                <Field label={`Type the name "${backup.source}" to confirm`}>
                  <Input
                    className="font-mono"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    placeholder={backup.source}
                    autoFocus
                  />
                </Field>
                {!typedOk && confirm.length > 0 && (
                  <div className="font-mono text-[11px] text-rose-500">
                    Typed name does not match.
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 border-t px-5 py-3">
        <span className="text-[11px] text-muted-foreground">
          Step {step + 1} of 3
        </span>
        <div className="flex-1" />
        {step > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setStep((step - 1) as 0 | 1)}
          >
            Back
          </Button>
        )}
        {step < 2 && (
          <Button size="sm" onClick={() => setStep((step + 1) as 1 | 2)}>
            Continue
          </Button>
        )}
        {step === 2 && target === "download" && (
          <Button size="sm" className="gap-1.5" onClick={onClose}>
            <HugeiconsIcon icon={Download01Icon} className="size-3" />
            Download
          </Button>
        )}
        {step === 2 && target !== "download" && (
          <Button
            size="sm"
            variant={target === "in-place" ? "destructive" : "default"}
            className="gap-1.5"
            disabled={!typedOk}
            onClick={onClose}
          >
            <HugeiconsIcon icon={Refresh01Icon} className="size-3" />
            {target === "in-place" ? "Restore in place" : "Restore as new"}
          </Button>
        )}
      </div>
    </DialogContent>
  );
}

function RestoreTargetCard({
  id,
  current,
  onSelect,
  title,
  sub,
  danger,
}: {
  id: RestoreTarget;
  current: RestoreTarget;
  onSelect: (t: RestoreTarget) => void;
  title: string;
  sub: string;
  danger?: boolean;
}) {
  const active = current === id;
  return (
    <button
      type="button"
      onClick={() => onSelect(id)}
      className={cn(
        "flex flex-col gap-1 rounded-md border p-3.5 text-left transition-colors",
        active
          ? danger
            ? "border-rose-500 bg-rose-500/5"
            : "border-foreground bg-muted/50"
          : "hover:bg-muted/30",
      )}
    >
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "text-sm font-semibold",
            danger ? "text-rose-500" : "text-foreground",
          )}
        >
          {title}
        </span>
        {danger && (
          <Badge
            variant="outline"
            className="border-rose-500/30 bg-rose-500/10 text-[10px] text-rose-500"
          >
            destructive
          </Badge>
        )}
      </div>
      <p className="text-xs text-muted-foreground">{sub}</p>
    </button>
  );
}
