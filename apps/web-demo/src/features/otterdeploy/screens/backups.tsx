import { useEffect, useMemo, useState } from "react";

import { Field, SectionH, Switch3 } from "../components/form";
import {
  ALL_PROJECTS,
  ProjectFilterStrip,
  ProjectTagBadge,
  matchesProjectFilter,
} from "../components/project-filter";
import { StatusBadge } from "../components/status-badge";
import { PROJECTS } from "../data";
import { I } from "../icons";

// ────────── Types ──────────
type BackupKind = "database" | "volume" | "stack";
type BackupStatus = "succeeded" | "failed" | "running" | "queued";
type DestinationId = "s3-helio-primary" | "s3-glacier-cold" | "local";
type DestinationKind = "s3" | "local" | "sftp";
type EncryptionMode = "AES-256 GCM" | "KMS-managed" | "customer-key" | "none";
type RetentionClass = "short" | "standard" | "long" | "archive";
type RestoreTarget = "in-place" | "as-new" | "download";

interface Backup {
  id: string;
  source: string;
  kind: BackupKind;
  /** Single-owner project id (new tag model — each resource has one project). */
  project: string;
  when: string;
  whenAbs: string;
  duration: string;
  sizeMB: number;
  destination: DestinationId;
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

// ────────── Static catalog ──────────
const DESTINATIONS: Destination[] = [
  {
    id: "s3-helio-primary",
    name: "S3 · helio-primary",
    uri: "s3://helio-backups.local",
    kind: "s3",
    sub: "Hot tier · single-region",
    usedGB: 18.4,
    encryption: "KMS-managed",
    status: "active",
  },
  {
    id: "s3-glacier-cold",
    name: "S3 · glacier-cold",
    uri: "s3://helio-backups-cold.glacier",
    kind: "s3",
    sub: "Infrequent access · 12-hour restore window",
    usedGB: 142,
    encryption: "KMS-managed",
    status: "active",
  },
  {
    id: "local",
    name: "Local disk",
    uri: "/var/backups/otterdeploy",
    kind: "local",
    sub: "Manager node · /var/backups",
    usedGB: 4.2,
    totalGB: 50,
    encryption: "AES-256 GCM",
    status: "active",
  },
];

const DESTINATION_BY_ID = Object.fromEntries(DESTINATIONS.map((d) => [d.id, d])) as Record<
  DestinationId,
  Destination
>;

// ────────── Seed backups ──────────
const SEED_BACKUPS: Backup[] = [
  {
    id: "bkp_3a8c1f9e",
    source: "postgres",
    kind: "database",
    project: "helio",
    when: "23m ago",
    whenAbs: "2026-05-03 11:37:14 UTC",
    duration: "0m 41s",
    sizeMB: 312,
    destination: "s3-helio-primary",
    encryption: "AES-256 GCM",
    status: "succeeded",
    method: "pg_dump --format=custom -Z9",
    checksum: "sha256:8a2c1f9e34b1f0c92ad77ee041b3fc218a45bf90c3d72e1baf00c9d11f3a7e22",
    retention: "standard",
    sourceSizeMB: 1180,
    compressedSizeMB: 312,
    sourceService: "postgres",
    sourceHost: "helio-prod-01:5432",
    log: [
      '11:37:14 [info] pg_dump: starting dump of database "helio"',
      '11:37:14 [info] pg_dump: dumping contents of table "public.events"',
      '11:37:31 [info] pg_dump: dumping contents of table "public.users"',
      "11:37:44 [info] gzip -9 helio.dump → helio.dump.gz",
      "11:37:51 [info] sha256sum helio.dump.gz",
      "11:37:55 [ok]   uploaded → s3://helio-backups.local/postgres/2026-05-03/helio.dump.gz",
    ],
  },
  {
    id: "bkp_7c2b6e01",
    source: "billing-pg",
    kind: "database",
    project: "billing",
    when: "1h ago",
    whenAbs: "2026-05-03 11:00:02 UTC",
    duration: "0m 27s",
    sizeMB: 184,
    destination: "s3-helio-primary",
    encryption: "AES-256 GCM",
    status: "succeeded",
    method: "pg_dump --format=custom -Z9",
    checksum: "sha256:7c2b6e01a47db119cc28f1e2900a7d3ef5a8a1cb2e90b5a5e3fbdc9421a4b0e7",
    retention: "standard",
    sourceSizeMB: 612,
    compressedSizeMB: 184,
    sourceService: "billing-pg",
    sourceHost: "helio-prod-02:5432",
    log: [
      '11:00:02 [info] pg_dump: starting dump of database "billing"',
      '11:00:09 [info] pg_dump: dumping table "public.invoices"',
      '11:00:18 [info] pg_dump: dumping table "public.charges"',
      "11:00:24 [info] gzip -9 billing.dump → billing.dump.gz",
      "11:00:27 [info] sha256sum billing.dump.gz",
      "11:00:29 [ok]   uploaded → s3://helio-backups.local/billing-pg/2026-05-03/billing.dump.gz",
    ],
  },
  {
    id: "bkp_a14d09b2",
    source: "redis",
    kind: "database",
    project: "helio",
    when: "1h ago",
    whenAbs: "2026-05-03 11:00:00 UTC",
    duration: "0m 06s",
    sizeMB: 18,
    destination: "local",
    encryption: "AES-256 GCM",
    status: "succeeded",
    method: "redis-cli BGSAVE → tar.gz",
    checksum: "sha256:a14d09b2e8f9c1d0a4b7e2316d2c84cf47e8ad4b2e0c3a0a1f0e2c8b4f9a7c3e",
    retention: "short",
    sourceSizeMB: 96,
    compressedSizeMB: 18,
    sourceService: "redis",
    sourceHost: "helio-prod-01:6379",
    log: [
      "11:00:00 [info] redis-cli BGSAVE issued",
      "11:00:02 [info] dump.rdb (96 MB) generated at /data/dump.rdb",
      "11:00:04 [info] tar -czf redis-2026-05-03T11.tgz dump.rdb",
      "11:00:05 [info] sha256sum redis-2026-05-03T11.tgz",
      "11:00:06 [ok]   copied → /var/backups/otterdeploy/redis/",
    ],
  },
  {
    id: "bkp_2f1abf04",
    source: "redis",
    kind: "database",
    project: "helio",
    when: "2h ago",
    whenAbs: "2026-05-03 10:00:00 UTC",
    duration: "0m 05s",
    sizeMB: 17,
    destination: "local",
    encryption: "AES-256 GCM",
    status: "succeeded",
    method: "redis-cli BGSAVE → tar.gz",
    checksum: "sha256:2f1abf04d1c0e3a2b5d8f7e6c4a9b1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8",
    retention: "short",
    sourceSizeMB: 92,
    compressedSizeMB: 17,
    sourceService: "redis",
    sourceHost: "helio-prod-01:6379",
    log: [
      "10:00:00 [info] redis-cli BGSAVE issued",
      "10:00:02 [info] dump.rdb (92 MB) generated at /data/dump.rdb",
      "10:00:03 [info] tar -czf redis-2026-05-03T10.tgz dump.rdb",
      "10:00:04 [info] sha256sum redis-2026-05-03T10.tgz",
      "10:00:05 [ok]   copied → /var/backups/otterdeploy/redis/",
    ],
  },
  {
    id: "bkp_f0e1d2c3",
    source: "postgres",
    kind: "database",
    project: "helio",
    when: "3h ago",
    whenAbs: "2026-05-03 09:00:00 UTC",
    duration: "0m 38s",
    sizeMB: 308,
    destination: "s3-helio-primary",
    encryption: "AES-256 GCM",
    status: "succeeded",
    method: "pg_dump --format=custom -Z9",
    checksum: "sha256:f0e1d2c3b4a5968778695a4b3c2d1e0f9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d",
    retention: "standard",
    sourceSizeMB: 1175,
    compressedSizeMB: 308,
    sourceService: "postgres",
    sourceHost: "helio-prod-01:5432",
    log: [
      '09:00:00 [info] pg_dump: starting dump of database "helio"',
      '09:00:14 [info] pg_dump: dumping contents of table "public.events"',
      "09:00:30 [info] gzip -9 helio.dump → helio.dump.gz",
      "09:00:36 [info] sha256sum helio.dump.gz",
      "09:00:38 [ok]   uploaded → s3://helio-backups.local/postgres/",
    ],
  },
  {
    id: "bkp_b9c8d7e6",
    source: "web-uploads",
    kind: "volume",
    project: "helio",
    when: "6h ago",
    whenAbs: "2026-05-03 06:00:00 UTC",
    duration: "4m 12s",
    sizeMB: 8200,
    destination: "s3-glacier-cold",
    encryption: "KMS-managed",
    status: "succeeded",
    method: "btrfs-snapshot + restic push",
    checksum: "sha256:b9c8d7e6f5a4938271605f4e3d2c1b0a9e8d7c6b5a49382716050f1e2d3c4b5a",
    retention: "long",
    sourceSizeMB: 12400,
    compressedSizeMB: 8200,
    sourceService: "web (uploads volume)",
    sourceHost: "helio-prod-02:/srv/uploads",
    log: [
      "06:00:00 [info] btrfs subvolume snapshot -r /srv/uploads /snap/uploads@2026-05-03",
      "06:00:08 [info] restic init --repo s3:helio-backups-cold.glacier/uploads",
      "06:00:18 [info] restic backup /snap/uploads@2026-05-03",
      "06:03:49 [info] processed 12.4 GiB in 3m 41s",
      "06:04:08 [info] sha256sum manifest.json",
      "06:04:12 [ok]   snapshot 8a2c1f9 stored",
    ],
  },
  {
    id: "bkp_4d3c2b1a",
    source: "stack.yml",
    kind: "stack",
    project: "helio",
    when: "8h ago",
    whenAbs: "2026-05-03 04:00:00 UTC",
    duration: "0m 01s",
    sizeMB: 0.004,
    destination: "s3-helio-primary",
    encryption: "AES-256 GCM",
    status: "succeeded",
    method: "git diff + tar (manifest only)",
    checksum: "sha256:4d3c2b1a09f8e7d6c5b4a39281706f5e4d3c2b1a09f8e7d6c5b4a39281706f5e",
    retention: "long",
    sourceSizeMB: 0.012,
    compressedSizeMB: 0.004,
    sourceService: "stack manifest watcher",
    sourceHost: "helio-prod-01:/etc/otterdeploy/stack.yml",
    log: [
      "04:00:00 [info] watcher: detected change in /etc/otterdeploy/stack.yml",
      "04:00:00 [info] git diff @{1} stack.yml > /tmp/stack.diff",
      "04:00:00 [info] tar -czf stack-2026-05-03T04.tgz stack.yml stack.diff",
      "04:00:01 [info] sha256sum stack-2026-05-03T04.tgz",
      "04:00:01 [ok]   uploaded → s3://helio-backups.local/stack/",
    ],
  },
  {
    id: "bkp_91a8b7c6",
    source: "billing-pg",
    kind: "database",
    project: "billing",
    when: "1d ago",
    whenAbs: "2026-05-02 11:00:02 UTC",
    duration: "0m 25s",
    sizeMB: 178,
    destination: "s3-helio-primary",
    encryption: "AES-256 GCM",
    status: "succeeded",
    method: "pg_dump --format=custom -Z9",
    checksum: "sha256:91a8b7c6d5e4f3029184756a3b2c1d0e9f8a7b6c5d4e3f2a1b0c9d8e7f6a5b4c",
    retention: "standard",
    sourceSizeMB: 598,
    compressedSizeMB: 178,
    sourceService: "billing-pg",
    sourceHost: "helio-prod-02:5432",
    log: [
      '11:00:02 [info] pg_dump: starting dump of database "billing"',
      '11:00:09 [info] pg_dump: dumping table "public.invoices"',
      '11:00:18 [info] pg_dump: dumping table "public.charges"',
      "11:00:23 [info] gzip -9 billing.dump → billing.dump.gz",
      "11:00:25 [info] sha256sum billing.dump.gz",
      "11:00:27 [ok]   uploaded → s3://helio-backups.local/billing-pg/",
    ],
  },
  {
    id: "bkp_5e6f7081",
    source: "postgres-data",
    kind: "volume",
    project: "helio",
    when: "1d ago",
    whenAbs: "2026-05-02 04:00:00 UTC",
    duration: "6m 02s",
    sizeMB: 11800,
    destination: "s3-glacier-cold",
    encryption: "KMS-managed",
    status: "succeeded",
    method: "btrfs-snapshot + restic push",
    checksum: "sha256:5e6f70819a8b7c6d5e4f30291847562e3d4c5b6a7980c1d2e3f4a5b6c7d8e9f0",
    retention: "archive",
    sourceSizeMB: 14600,
    compressedSizeMB: 11800,
    sourceService: "postgres (data volume)",
    sourceHost: "helio-prod-01:/var/lib/postgresql",
    log: [
      "04:00:00 [info] systemctl stop postgres-prewarm",
      "04:00:01 [info] btrfs subvolume snapshot -r /var/lib/postgresql /snap/pg@2026-05-02",
      "04:00:14 [info] restic backup /snap/pg@2026-05-02",
      "04:05:48 [info] processed 14.6 GiB in 5m 34s",
      "04:06:00 [info] sha256sum manifest.json",
      "04:06:02 [ok]   snapshot 5e6f708 stored",
    ],
  },
  {
    id: "bkp_d2c1b0a9",
    source: "postgres",
    kind: "database",
    project: "helio",
    when: "1d ago",
    whenAbs: "2026-05-02 03:00:00 UTC",
    duration: "0m 35s",
    sizeMB: 304,
    destination: "s3-helio-primary",
    encryption: "AES-256 GCM",
    status: "succeeded",
    method: "pg_dump --format=custom -Z9",
    checksum: "sha256:d2c1b0a9e8f7c6b5a49382716050f1e2d3c4b5a69788cdef0a1b2c3d4e5f6a78",
    retention: "standard",
    sourceSizeMB: 1162,
    compressedSizeMB: 304,
    sourceService: "postgres",
    sourceHost: "helio-prod-01:5432",
    log: [
      '03:00:00 [info] pg_dump: starting dump of database "helio"',
      '03:00:14 [info] pg_dump: dumping contents of table "public.events"',
      "03:00:28 [info] gzip -9 helio.dump → helio.dump.gz",
      "03:00:33 [info] sha256sum helio.dump.gz",
      "03:00:35 [ok]   uploaded → s3://helio-backups.local/postgres/",
    ],
  },
  {
    id: "bkp_8b7a6c5d",
    source: "billing-pg",
    kind: "database",
    project: "billing",
    when: "2d ago",
    whenAbs: "2026-05-01 11:00:02 UTC",
    duration: "0m 12s",
    sizeMB: 0,
    destination: "s3-helio-primary",
    encryption: "AES-256 GCM",
    status: "failed",
    method: "pg_dump --format=custom -Z9",
    checksum: "—",
    retention: "standard",
    sourceSizeMB: 598,
    compressedSizeMB: 0,
    sourceService: "billing-pg",
    sourceHost: "helio-prod-02:5432",
    error:
      'pg_dump: connection to server at "billing-pg" (10.0.4.12), port 5432 failed: Operation timed out',
    log: [
      "11:00:02 [info] pg_dump: connecting to billing-pg:5432",
      "11:00:14 [warn] tcp connect retry 1/3",
      "11:00:26 [warn] tcp connect retry 2/3",
      "11:00:38 [warn] tcp connect retry 3/3",
      '11:00:50 [err]  pg_dump: error: connection to server at "billing-pg" (10.0.4.12) failed: Operation timed out',
      "11:00:50 [err]  job exited with code 1",
    ],
  },
  {
    id: "bkp_a3c2b1f0",
    source: "redis",
    kind: "database",
    project: "billing",
    when: "running now",
    whenAbs: "2026-05-03 12:00:00 UTC",
    duration: "00:00:08",
    sizeMB: 0,
    destination: "local",
    encryption: "AES-256 GCM",
    status: "running",
    method: "redis-cli BGSAVE → tar.gz",
    checksum: "(pending)",
    retention: "short",
    sourceSizeMB: 94,
    compressedSizeMB: 0,
    sourceService: "redis",
    sourceHost: "helio-prod-01:6379",
    log: [
      "12:00:00 [info] redis-cli BGSAVE issued",
      "12:00:02 [info] dump.rdb writing… (background save in progress)",
    ],
  },
  {
    id: "bkp_e9d8c7b6",
    source: "stack.yml",
    kind: "stack",
    project: "marketing",
    when: "queued",
    whenAbs: "2026-05-03 12:01:00 UTC",
    duration: "—",
    sizeMB: 0,
    destination: "s3-helio-primary",
    encryption: "AES-256 GCM",
    status: "queued",
    method: "git diff + tar (manifest only)",
    checksum: "(queued)",
    retention: "long",
    sourceSizeMB: 0.008,
    compressedSizeMB: 0,
    sourceService: "stack manifest watcher",
    sourceHost: "helio-prod-01:/etc/otterdeploy/marketing/stack.yml",
    log: ["12:01:00 [info] queued behind 1 running job"],
  },
  {
    id: "bkp_062a1bcd",
    source: "web-uploads",
    kind: "volume",
    project: "marketing",
    when: "4d ago",
    whenAbs: "2026-04-29 04:00:00 UTC",
    duration: "3m 41s",
    sizeMB: 3120,
    destination: "s3-glacier-cold",
    encryption: "KMS-managed",
    status: "succeeded",
    method: "btrfs-snapshot + restic push",
    checksum: "sha256:062a1bcd3f4e5d6c7b8a90112233445566778899aabbccddeeff0011223344556",
    retention: "long",
    sourceSizeMB: 4900,
    compressedSizeMB: 3120,
    sourceService: "marketing-site (assets)",
    sourceHost: "helio-prod-03:/srv/marketing/assets",
    log: [
      "04:00:00 [info] btrfs subvolume snapshot -r /srv/marketing/assets /snap/marketing@2026-04-29",
      "04:00:08 [info] restic backup /snap/marketing@2026-04-29",
      "04:03:37 [info] processed 4.9 GiB in 3m 29s",
      "04:03:40 [info] sha256sum manifest.json",
      "04:03:41 [ok]   snapshot 062a1bc stored",
    ],
  },
];

// ────────── Static schedules ──────────
const SEED_SCHEDULES: Schedule[] = [
  {
    id: "sched_pg_daily",
    name: "Daily Postgres dump",
    sources: ["postgres", "billing-pg"],
    cron: "0 3 * * *",
    cronHuman: "Every day at 03:00 UTC",
    retentionLabel: "Keep 14 daily + 4 weekly",
    destination: "s3-helio-primary",
    encryption: "AES-256 GCM",
    pitr: true,
    enabled: true,
    lastRun: "3h ago",
    lastRunStatus: "succeeded",
    nextRun: "in 21h",
  },
  {
    id: "sched_redis_hourly",
    name: "Hourly Redis snapshot",
    sources: ["redis"],
    cron: "0 * * * *",
    cronHuman: "Every hour on the hour",
    retentionLabel: "Keep last 24 hours",
    destination: "local",
    encryption: "AES-256 GCM",
    pitr: false,
    enabled: true,
    lastRun: "1h ago",
    lastRunStatus: "succeeded",
    nextRun: "in 38m",
  },
  {
    id: "sched_volumes_weekly",
    name: "Weekly volume snapshot",
    sources: ["web-uploads", "postgres-data", "marketing-assets"],
    cron: "0 4 * * 0",
    cronHuman: "Sundays at 04:00 UTC",
    retentionLabel: "Keep 8 weekly + 12 monthly",
    destination: "s3-glacier-cold",
    encryption: "KMS-managed",
    pitr: false,
    enabled: true,
    lastRun: "1d ago",
    lastRunStatus: "succeeded",
    nextRun: "in 6d",
  },
  {
    id: "sched_stack_change",
    name: "Stack manifest on change",
    sources: ["stack.yml"],
    cron: "@watch",
    cronHuman: "On every change to stack.yml",
    retentionLabel: "Keep 90 days",
    destination: "s3-helio-primary",
    encryption: "AES-256 GCM",
    pitr: false,
    enabled: true,
    lastRun: "8h ago",
    lastRunStatus: "succeeded",
    nextRun: "on next change",
  },
];

// ────────── Helpers ──────────
function fmtSize(mb: number): string {
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  if (mb >= 1) return `${mb.toFixed(0)} MB`;
  if (mb > 0) return `${(mb * 1024).toFixed(0)} KB`;
  return "—";
}

function kindIcon(k: BackupKind) {
  if (k === "database") return I.db;
  if (k === "volume") return I.folder;
  return I.doc;
}

function destIcon(k: DestinationKind) {
  if (k === "s3") return I.globe;
  if (k === "sftp") return I.upload;
  return I.server;
}

function statusToBadgeKey(s: BackupStatus): string {
  if (s === "succeeded") return "live"; // ok styling
  if (s === "failed") return "failed";
  if (s === "running") return "building";
  return "queued";
}

function kindLabel(k: BackupKind): string {
  if (k === "database") return "DB";
  if (k === "volume") return "volume";
  return "stack";
}

// ────────── Modal shell ──────────
function ModalShell({
  width = 640,
  title,
  subtitle,
  onClose,
  footer,
  children,
}: {
  width?: number;
  title: string;
  subtitle?: string;
  onClose: () => void;
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 200,
        background: "rgba(0,0,0,0.4)",
        display: "grid",
        placeItems: "center",
        backdropFilter: "blur(2px)",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width,
          maxWidth: "96vw",
          maxHeight: "88vh",
          background: "var(--bg-elev)",
          border: "1px solid var(--border)",
          borderRadius: 12,
          boxShadow: "var(--shadow-lg)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <div
          className="row gap-2"
          style={{
            padding: "14px 18px",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <div className="col" style={{ gap: 2 }}>
            <span style={{ fontWeight: 600, fontSize: 14 }}>{title}</span>
            {subtitle && (
              <span className="muted" style={{ fontSize: 11 }}>
                {subtitle}
              </span>
            )}
          </div>
          <div style={{ flex: 1 }} />
          <span className="muted" style={{ fontSize: 11 }}>
            press Esc to close
          </span>
          <button className="btn ghost icon sm" onClick={onClose}>
            <I.close width={13} height={13} />
          </button>
        </div>
        <div style={{ padding: 18, overflow: "auto", flex: 1, minHeight: 0 }}>{children}</div>
        {footer && (
          <div
            className="row gap-2"
            style={{
              padding: "12px 18px",
              borderTop: "1px solid var(--border)",
              background: "var(--bg-sunken)",
            }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

// ────────── Main screen ──────────
export function Backups() {
  const [backups, setBackups] = useState<Backup[]>(SEED_BACKUPS);
  const [schedules, setSchedules] = useState<Schedule[]>(SEED_SCHEDULES);
  const [projectFilter, setProjectFilter] = useState<string>(ALL_PROJECTS);
  const [kindFilter, setKindFilter] = useState<"all" | BackupKind>("all");
  const [destFilter, setDestFilter] = useState<"all" | DestinationId>("all");
  const [search, setSearch] = useState<string>("");
  const [expanded, setExpanded] = useState<string | null>(null);

  // Modals
  const [backupNowOpen, setBackupNowOpen] = useState(false);
  const [scheduleEditor, setScheduleEditor] = useState<Schedule | "new" | null>(null);
  const [restoreFor, setRestoreFor] = useState<Backup | null>(null);

  const projectCounts = useMemo(() => {
    const out: Record<string, number> = {};
    for (const p of PROJECTS) out[p.id] = backups.filter((b) => b.project === p.id).length;
    return out;
  }, [backups]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return backups.filter((b) => {
      if (!matchesProjectFilter(projectFilter, [b.project])) return false;
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

  // Stats
  const totalCount = backups.length;
  const totalSizeMB = backups
    .filter((b) => b.status === "succeeded")
    .reduce((acc, b) => acc + b.sizeMB, 0);
  const lastSuccess = backups.find((b) => b.status === "succeeded");
  const lastFail = backups.find((b) => b.status === "failed");

  const onDeleteBackup = (id: string) => setBackups((bs) => bs.filter((b) => b.id !== id));
  const onToggleSchedule = (id: string) =>
    setSchedules((ss) => ss.map((s) => (s.id === id ? { ...s, enabled: !s.enabled } : s)));

  return (
    <div className="os-scroll" style={{ flex: 1, overflow: "auto", padding: 24 }}>
      <div style={{ maxWidth: 1180, margin: "0 auto" }}>
        {/* Header */}
        <div className="row" style={{ marginBottom: 18 }}>
          <div>
            <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.01em" }}>Backups</div>
            <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>
              Daily database dumps · weekly volume snapshots · stack manifest history
            </div>
          </div>
          <div style={{ flex: 1 }} />
          <div className="row gap-2">
            <button className="btn" onClick={() => setScheduleEditor("new")}>
              <I.clock width={12} height={12} /> Schedule
            </button>
            <button className="btn primary" onClick={() => setBackupNowOpen(true)}>
              <I.upload width={12} height={12} /> Backup now
            </button>
          </div>
        </div>

        {/* Stats row */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            gap: 12,
            marginBottom: 22,
          }}
        >
          <Stat
            label="Total backups"
            value={String(totalCount)}
            sub={`${filtered.length} match filters`}
          />
          <Stat label="Stored size" value={fmtSize(totalSizeMB)} sub="across all destinations" />
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

        {/* Filter row */}
        <div className="row gap-2" style={{ marginBottom: 14, flexWrap: "wrap" }}>
          <ProjectFilterStrip
            active={projectFilter}
            onChange={setProjectFilter}
            counts={projectCounts}
          />
          <Segmented
            value={kindFilter}
            onChange={(v) => setKindFilter(v as typeof kindFilter)}
            options={[
              { id: "all", label: "All" },
              { id: "database", label: "Database" },
              { id: "volume", label: "Volume" },
              { id: "stack", label: "Stack" },
            ]}
          />
          <select
            className="input"
            value={destFilter}
            onChange={(e) => setDestFilter(e.target.value as typeof destFilter)}
            style={{ height: 28, fontSize: 12, padding: "0 10px" }}
          >
            <option value="all">All destinations</option>
            {DESTINATIONS.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
          <div style={{ flex: 1 }} />
          <div
            className="row gap-1"
            style={{
              border: "1px solid var(--border)",
              borderRadius: 6,
              padding: "0 8px",
              height: 28,
              background: "var(--bg-sunken)",
              minWidth: 240,
            }}
          >
            <I.search width={12} height={12} style={{ color: "var(--fg-3)" }} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search source, host, id…"
              style={{
                background: "transparent",
                border: 0,
                outline: 0,
                color: "var(--fg)",
                fontSize: 12,
                flex: 1,
                fontFamily: "var(--font-mono)",
              }}
            />
            {search && (
              <button className="btn ghost icon sm" onClick={() => setSearch("")}>
                <I.close width={10} height={10} />
              </button>
            )}
          </div>
        </div>

        {/* Backup table */}
        <div className="card" style={{ overflow: "hidden", marginBottom: 28 }}>
          <div className="os-pe-head" style={{ gap: 8 }}>
            <span style={{ flex: 2.4 }}>Source</span>
            <span style={{ flex: 1.2 }}>Project</span>
            <span style={{ flex: 1.1 }}>When</span>
            <span style={{ width: 80 }}>Duration</span>
            <span style={{ width: 80 }}>Size</span>
            <span style={{ flex: 1.1 }}>Destination</span>
            <span style={{ width: 110 }}>Encryption</span>
            <span style={{ width: 100 }}>Status</span>
            <span style={{ width: 110 }} />
          </div>
          {filtered.length === 0 && (
            <div className="muted" style={{ padding: 24, fontSize: 12, textAlign: "center" }}>
              No backups match these filters.
            </div>
          )}
          {filtered.map((b) => {
            const KIcon = kindIcon(b.kind);
            const dest = DESTINATION_BY_ID[b.destination];
            const DIcon = destIcon(dest.kind);
            const isExpanded = expanded === b.id;
            return (
              <div key={b.id} style={{ borderBottom: "1px solid var(--border)" }}>
                <div
                  className="os-pe-row"
                  style={{ gap: 8, cursor: "pointer", borderBottom: 0 }}
                  onClick={() => setExpanded(isExpanded ? null : b.id)}
                >
                  <span
                    style={{
                      flex: 2.4,
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      minWidth: 0,
                    }}
                  >
                    <span style={{ color: "var(--fg-3)", display: "inline-flex" }}>
                      <KIcon width={13} height={13} />
                    </span>
                    <span
                      className="mono"
                      style={{
                        fontSize: 12,
                        fontWeight: 500,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {b.source}
                    </span>
                    <span
                      className="mono"
                      style={{
                        fontSize: 10,
                        padding: "1px 5px",
                        borderRadius: 3,
                        background: "var(--bg-overlay)",
                        color: "var(--fg-3)",
                      }}
                    >
                      {kindLabel(b.kind)}
                    </span>
                  </span>
                  <span style={{ flex: 1.2 }}>
                    <ProjectTagBadge id={b.project} />
                  </span>
                  <span
                    className="mono muted"
                    style={{ flex: 1.1, fontSize: 11 }}
                    title={b.whenAbs}
                  >
                    {b.when}
                  </span>
                  <span className="mono" style={{ width: 80, fontSize: 11, color: "var(--fg-2)" }}>
                    {b.duration}
                  </span>
                  <span className="mono" style={{ width: 80, fontSize: 11, color: "var(--fg-2)" }}>
                    {fmtSize(b.sizeMB)}
                  </span>
                  <span
                    style={{
                      flex: 1.1,
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      minWidth: 0,
                    }}
                  >
                    <span style={{ color: "var(--fg-3)", display: "inline-flex" }}>
                      <DIcon width={11} height={11} />
                    </span>
                    <span
                      className="mono"
                      style={{
                        fontSize: 11,
                        color: "var(--fg-2)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {dest.name}
                    </span>
                  </span>
                  <span style={{ width: 110 }}>
                    {b.encryption !== "none" ? (
                      <span
                        className="mono"
                        style={{
                          fontSize: 10,
                          padding: "1px 6px",
                          borderRadius: 3,
                          background: "var(--ok-bg)",
                          color: "var(--ok)",
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 4,
                        }}
                      >
                        <I.lock width={9} height={9} />
                        {b.encryption}
                      </span>
                    ) : (
                      <span className="muted mono" style={{ fontSize: 11 }}>
                        —
                      </span>
                    )}
                  </span>
                  <span style={{ width: 100 }}>
                    <StatusBadge status={statusToBadgeKey(b.status)}>{b.status}</StatusBadge>
                  </span>
                  <span
                    style={{
                      width: 110,
                      display: "flex",
                      justifyContent: "flex-end",
                      gap: 2,
                    }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      className="btn ghost icon sm"
                      title="Restore"
                      onClick={() => setRestoreFor(b)}
                      disabled={b.status !== "succeeded"}
                    >
                      <I.refresh width={11} height={11} />
                    </button>
                    <button
                      className="btn ghost icon sm"
                      title="Download"
                      disabled={b.status !== "succeeded"}
                    >
                      <I.download width={11} height={11} />
                    </button>
                    <button
                      className="btn ghost icon sm"
                      title="Delete"
                      onClick={() => onDeleteBackup(b.id)}
                    >
                      <I.trash width={11} height={11} />
                    </button>
                    <span style={{ color: "var(--fg-3)", display: "inline-flex", marginLeft: 4 }}>
                      <I.chev
                        width={10}
                        height={10}
                        style={{
                          transform: isExpanded ? "rotate(90deg)" : "none",
                          transition: "transform 120ms",
                        }}
                      />
                    </span>
                  </span>
                </div>
                {isExpanded && <BackupDetail backup={b} />}
              </div>
            );
          })}
          <div
            className="row"
            style={{
              padding: "8px 14px",
              borderTop: "1px solid var(--border)",
              fontSize: 11,
              color: "var(--fg-3)",
              background: "var(--bg-sunken)",
            }}
          >
            <I.folder width={11} height={11} />
            <span style={{ marginLeft: 4 }}>
              {filtered.length} of {totalCount} backup{totalCount === 1 ? "" : "s"}
            </span>
            <div style={{ flex: 1 }} />
            <span className="mono" style={{ fontSize: 11 }}>
              {fmtSize(filtered.reduce((acc, b) => acc + b.sizeMB, 0))} in view
            </span>
          </div>
        </div>

        {/* Schedules */}
        <div className="row" style={{ marginBottom: 12 }}>
          <SectionH title="Schedules" sub="Recurring backup pipelines" />
          <div style={{ flex: 1 }} />
          <button className="btn sm" onClick={() => setScheduleEditor("new")}>
            <I.plus width={11} height={11} /> New schedule
          </button>
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(2, 1fr)",
            gap: 12,
            marginBottom: 30,
          }}
        >
          {schedules.map((s) => (
            <ScheduleCard
              key={s.id}
              schedule={s}
              onToggle={() => onToggleSchedule(s.id)}
              onEdit={() => setScheduleEditor(s)}
            />
          ))}
        </div>

        {/* Destinations */}
        <div className="row" style={{ marginBottom: 12 }}>
          <SectionH title="Destinations" sub="Where backups are written" />
          <div style={{ flex: 1 }} />
          <button
            className="btn ghost sm"
            style={{ color: "var(--fg-2)" }}
            title="Routes to Settings → Destinations"
          >
            <I.plus width={11} height={11} /> Add destination
          </button>
        </div>
        <div className="card" style={{ overflow: "hidden", marginBottom: 40 }}>
          {DESTINATIONS.map((d, i) => (
            <DestinationRow key={d.id} dest={d} first={i === 0} />
          ))}
        </div>
      </div>

      {/* Modals */}
      {backupNowOpen && <BackupNowModal onClose={() => setBackupNowOpen(false)} />}
      {scheduleEditor && (
        <ScheduleEditorModal
          initial={scheduleEditor === "new" ? null : scheduleEditor}
          onClose={() => setScheduleEditor(null)}
        />
      )}
      {restoreFor && <RestoreWizard backup={restoreFor} onClose={() => setRestoreFor(null)} />}
    </div>
  );
}

// ────────── Stat ──────────
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
    <div className="card" style={{ padding: 14 }}>
      <div
        className="muted"
        style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em" }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 22,
          fontWeight: 600,
          letterSpacing: "-0.02em",
          marginTop: 4,
          color: tone === "warn" ? "var(--warn)" : undefined,
          fontFamily: tone === "warn" ? "var(--font-mono)" : undefined,
        }}
      >
        {value}
      </div>
      <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
        {sub}
      </div>
    </div>
  );
}

// ────────── Segmented control ──────────
function Segmented({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: Array<{ id: string; label: string }>;
}) {
  return (
    <div
      className="row gap-1"
      style={{
        background: "var(--bg-sunken)",
        padding: 3,
        borderRadius: 6,
        border: "1px solid var(--border)",
        display: "inline-flex",
      }}
    >
      {options.map((o) => {
        const active = value === o.id;
        return (
          <button
            key={o.id}
            type="button"
            onClick={() => onChange(o.id)}
            style={{
              padding: "4px 10px",
              fontSize: 11,
              borderRadius: 4,
              background: active ? "var(--bg-elev)" : "transparent",
              color: active ? "var(--fg)" : "var(--fg-3)",
              fontWeight: active ? 500 : 400,
              cursor: "pointer",
              boxShadow: active ? "var(--shadow-sm)" : "none",
              border: 0,
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// ────────── Backup detail (expanded row) ──────────
function BackupDetail({ backup }: { backup: Backup }) {
  return (
    <div
      style={{
        background: "var(--bg-sunken)",
        borderTop: "1px solid var(--border)",
        padding: "14px 18px",
      }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 14,
          marginBottom: 12,
        }}
      >
        <DetailField label="Backup ID" value={backup.id} mono />
        <DetailField label="Method" value={backup.method} mono />
        <DetailField label="Retention class" value={backup.retention} />
        <DetailField
          label="Source service"
          value={`${backup.sourceService} @ ${backup.sourceHost}`}
          mono
        />
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: 14,
          marginBottom: 12,
        }}
      >
        <DetailField label="Source size" value={fmtSize(backup.sourceSizeMB)} mono />
        <DetailField label="Compressed" value={fmtSize(backup.compressedSizeMB)} mono />
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
      <div className="col gap-1" style={{ marginBottom: 12 }}>
        <span
          className="muted"
          style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em" }}
        >
          Checksum
        </span>
        <code
          className="mono"
          style={{
            fontSize: 11,
            background: "var(--bg-elev)",
            border: "1px solid var(--border)",
            padding: "5px 8px",
            borderRadius: 4,
            color: "var(--fg-2)",
            wordBreak: "break-all",
          }}
        >
          {backup.checksum}
        </code>
      </div>
      {backup.error && (
        <div
          style={{
            background: "var(--err-bg)",
            border: "1px solid color-mix(in srgb, var(--err) 30%, transparent)",
            borderRadius: 6,
            padding: "8px 12px",
            marginBottom: 12,
            display: "flex",
            gap: 8,
          }}
        >
          <I.warning width={13} height={13} style={{ color: "var(--err)", marginTop: 2 }} />
          <div className="mono" style={{ fontSize: 11, color: "var(--err)" }}>
            {backup.error}
          </div>
        </div>
      )}
      <div className="col gap-1">
        <span
          className="muted"
          style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em" }}
        >
          Log preview · last {backup.log.length} lines
        </span>
        <div
          className="mono"
          style={{
            background: "var(--bg-elev)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            padding: 10,
            fontSize: 11,
            lineHeight: 1.7,
            color: "var(--fg-2)",
            maxHeight: 160,
            overflow: "auto",
          }}
        >
          {backup.log.map((l, i) => (
            <div
              key={i}
              style={{
                color: l.includes("[err]")
                  ? "var(--err)"
                  : l.includes("[warn]")
                    ? "var(--warn)"
                    : l.includes("[ok]")
                      ? "var(--ok)"
                      : "var(--fg-2)",
              }}
            >
              {l}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function DetailField({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="col" style={{ gap: 2 }}>
      <span
        className="muted"
        style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em" }}
      >
        {label}
      </span>
      <span
        className={mono ? "mono" : undefined}
        style={{ fontSize: 12, color: "var(--fg-2)", wordBreak: "break-word" }}
      >
        {value}
      </span>
    </div>
  );
}

// ────────── Schedule card ──────────
function ScheduleCard({
  schedule,
  onToggle,
  onEdit,
}: {
  schedule: Schedule;
  onToggle: () => void;
  onEdit: () => void;
}) {
  const dest = DESTINATION_BY_ID[schedule.destination];
  const DIcon = destIcon(dest.kind);
  return (
    <div className="card" style={{ padding: 16 }}>
      <div className="row gap-2" style={{ marginBottom: 4 }}>
        <I.clock width={14} height={14} style={{ color: "var(--fg-2)" }} />
        <span style={{ fontWeight: 600, fontSize: 13 }}>{schedule.name}</span>
        <div style={{ flex: 1 }} />
        <Switch3 on={schedule.enabled} onChange={onToggle} />
      </div>
      <div className="muted" style={{ fontSize: 11 }}>
        {schedule.sources.length} source{schedule.sources.length === 1 ? "" : "s"} ·{" "}
        <span className="mono">{schedule.sources.slice(0, 3).join(", ")}</span>
        {schedule.sources.length > 3 && <span> +{schedule.sources.length - 3}</span>}
      </div>

      <div
        style={{
          marginTop: 12,
          padding: "8px 10px",
          background: "var(--bg-sunken)",
          border: "1px solid var(--border)",
          borderRadius: 6,
        }}
      >
        <div className="mono" style={{ fontSize: 12, color: "var(--fg)" }}>
          {schedule.cron}
        </div>
        <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
          {schedule.cronHuman}
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 10,
          marginTop: 12,
        }}
      >
        <div className="col" style={{ gap: 2 }}>
          <span
            className="muted"
            style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em" }}
          >
            Retention
          </span>
          <span style={{ fontSize: 12, color: "var(--fg-2)" }}>{schedule.retentionLabel}</span>
        </div>
        <div className="col" style={{ gap: 2 }}>
          <span
            className="muted"
            style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em" }}
          >
            Destination
          </span>
          <span className="row gap-1" style={{ fontSize: 12, color: "var(--fg-2)" }}>
            <DIcon width={11} height={11} style={{ color: "var(--fg-3)" }} />
            <span className="mono">{dest.name}</span>
          </span>
        </div>
      </div>

      <div
        className="row gap-3"
        style={{
          marginTop: 12,
          paddingTop: 12,
          borderTop: "1px solid var(--border)",
          fontSize: 11,
        }}
      >
        <div className="col" style={{ gap: 2 }}>
          <span
            className="muted"
            style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em" }}
          >
            Last run
          </span>
          <span className="row gap-1">
            <StatusBadge status={statusToBadgeKey(schedule.lastRunStatus)}>
              {schedule.lastRunStatus}
            </StatusBadge>
            <span className="muted mono" style={{ fontSize: 11 }}>
              {schedule.lastRun}
            </span>
          </span>
        </div>
        <div className="col" style={{ gap: 2 }}>
          <span
            className="muted"
            style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em" }}
          >
            Next run
          </span>
          <span className="mono" style={{ fontSize: 12, color: "var(--fg-2)" }}>
            {schedule.nextRun}
          </span>
        </div>
        <div style={{ flex: 1 }} />
        {schedule.pitr && (
          <span
            className="badge"
            style={{ background: "var(--info-bg)", color: "var(--info)", fontSize: 10 }}
            title="Point-in-time recovery enabled"
          >
            PITR
          </span>
        )}
        {schedule.encryption !== "none" && (
          <span className="badge" style={{ fontSize: 10 }}>
            <I.lock width={9} height={9} /> {schedule.encryption}
          </span>
        )}
      </div>

      <div className="row gap-2" style={{ marginTop: 12 }}>
        <button className="btn sm" onClick={onEdit}>
          <I.edit width={11} height={11} /> Edit
        </button>
        <button className="btn sm">
          <I.bolt width={11} height={11} /> Run now
        </button>
      </div>
    </div>
  );
}

// ────────── Destination row ──────────
function DestinationRow({ dest, first }: { dest: Destination; first: boolean }) {
  const DIcon = destIcon(dest.kind);
  const pct = dest.totalGB ? (dest.usedGB / dest.totalGB) * 100 : null;
  return (
    <div
      className="row gap-3"
      style={{
        padding: "14px 16px",
        borderTop: first ? "none" : "1px solid var(--border)",
      }}
    >
      <div
        style={{
          width: 32,
          height: 32,
          borderRadius: 6,
          background: "var(--bg-sunken)",
          border: "1px solid var(--border)",
          display: "grid",
          placeItems: "center",
          color: "var(--fg-2)",
        }}
      >
        <DIcon width={14} height={14} />
      </div>
      <div className="col" style={{ gap: 2, minWidth: 0, flex: 1 }}>
        <div className="row gap-2">
          <span style={{ fontWeight: 600, fontSize: 13 }}>{dest.name}</span>
          <span
            className="mono"
            style={{
              fontSize: 11,
              color: "var(--fg-3)",
              background: "var(--bg-sunken)",
              padding: "1px 6px",
              borderRadius: 3,
            }}
          >
            {dest.uri}
          </span>
        </div>
        <div className="muted" style={{ fontSize: 11 }}>
          {dest.sub} · encryption: {dest.encryption}
        </div>
      </div>
      <div className="col" style={{ gap: 2, alignItems: "flex-end", minWidth: 160 }}>
        <span className="mono" style={{ fontSize: 12, color: "var(--fg)" }}>
          {dest.usedGB} GB
          {dest.totalGB ? <span className="muted"> / {dest.totalGB} GB</span> : null}
        </span>
        {pct != null && (
          <div
            style={{
              width: 140,
              height: 3,
              background: "var(--bg-overlay)",
              borderRadius: 2,
              marginTop: 4,
            }}
          >
            <div
              style={{
                width: `${pct}%`,
                height: "100%",
                background: pct > 80 ? "var(--warn)" : "var(--fg-2)",
                borderRadius: 2,
              }}
            />
          </div>
        )}
      </div>
      <StatusBadge status={dest.status} />
      <button className="btn ghost icon sm" title="Settings">
        <I.settings width={12} height={12} />
      </button>
    </div>
  );
}

// ────────── Backup-now modal ──────────
function BackupNowModal({ onClose }: { onClose: () => void }) {
  const [kind, setKind] = useState<BackupKind>("database");
  const [source, setSource] = useState("postgres");
  const [destination, setDestination] = useState<DestinationId>("s3-helio-primary");
  const [encrypted, setEncrypted] = useState(true);
  const [starting, setStarting] = useState(false);

  const sourcesByKind: Record<BackupKind, string[]> = {
    database: ["postgres", "billing-pg", "redis"],
    volume: ["web-uploads", "postgres-data", "marketing-assets"],
    stack: ["stack.yml", "marketing/stack.yml"],
  };

  return (
    <ModalShell
      title="Run a backup now"
      subtitle="Choose what to back up. Runs out-of-band from the schedule."
      onClose={onClose}
      width={560}
      footer={
        <>
          <div style={{ flex: 1 }} />
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn primary"
            disabled={starting}
            onClick={() => {
              setStarting(true);
              setTimeout(() => {
                setStarting(false);
                onClose();
              }, 800);
            }}
          >
            <I.bolt width={11} height={11} /> {starting ? "Starting…" : "Start backup"}
          </button>
        </>
      }
    >
      <div className="col gap-4">
        <Field label="Backup kind">
          <Segmented
            value={kind}
            onChange={(v) => {
              const nk = v as BackupKind;
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
          <select className="input mono" value={source} onChange={(e) => setSource(e.target.value)}>
            {sourcesByKind[kind].map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Destination">
          <select
            className="input"
            value={destination}
            onChange={(e) => setDestination(e.target.value as DestinationId)}
          >
            {DESTINATIONS.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name} — {d.uri}
              </option>
            ))}
          </select>
        </Field>
        <div
          className="row gap-3"
          style={{
            padding: "10px 12px",
            background: "var(--bg-sunken)",
            border: "1px solid var(--border)",
            borderRadius: 6,
          }}
        >
          <I.lock width={14} height={14} style={{ color: "var(--fg-2)" }} />
          <div className="col" style={{ flex: 1 }}>
            <span style={{ fontSize: 12, fontWeight: 500 }}>Encrypt at rest</span>
            <span className="muted" style={{ fontSize: 11 }}>
              AES-256 GCM · key managed by destination policy
            </span>
          </div>
          <Switch3 on={encrypted} onChange={setEncrypted} />
        </div>
      </div>
    </ModalShell>
  );
}

// ────────── Schedule editor modal ──────────
function ScheduleEditorModal({
  initial,
  onClose,
}: {
  initial: Schedule | null;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "New backup schedule");
  const [sourcesText, setSourcesText] = useState((initial?.sources ?? ["postgres"]).join(", "));
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
    initial?.destination ?? "s3-helio-primary",
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
    <ModalShell
      title={initial ? `Edit schedule · ${initial.name}` : "New backup schedule"}
      subtitle="Cron-driven pipeline that runs even when the dashboard is closed."
      onClose={onClose}
      width={680}
      footer={
        <>
          <div style={{ flex: 1 }} />
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={onClose}>
            <I.check width={11} height={11} /> Save schedule
          </button>
        </>
      }
    >
      <div className="col gap-4">
        <Field label="Name">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>

        <Field label="Sources (comma-separated service / volume / manifest names)">
          <input
            className="input mono"
            value={sourcesText}
            onChange={(e) => setSourcesText(e.target.value)}
          />
        </Field>

        <div>
          <div className="muted" style={{ fontSize: 11, marginBottom: 6 }}>
            Cron preset
          </div>
          <Segmented
            value={preset}
            onChange={(v) => {
              const np = v as CronPreset;
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
          <input
            className="input mono"
            value={cron}
            onChange={(e) => {
              setCron(e.target.value);
              setPreset("custom");
            }}
          />
        </Field>

        <div className="col gap-2">
          <div className="muted" style={{ fontSize: 11 }}>
            Retention rules
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(4, 1fr)",
              gap: 10,
            }}
          >
            <Field label="Keep daily">
              <input
                className="input mono"
                type="number"
                min={0}
                value={keepDaily}
                onChange={(e) => setKeepDaily(Number(e.target.value))}
              />
            </Field>
            <Field label="Keep weekly">
              <input
                className="input mono"
                type="number"
                min={0}
                value={keepWeekly}
                onChange={(e) => setKeepWeekly(Number(e.target.value))}
              />
            </Field>
            <Field label="Keep monthly">
              <input
                className="input mono"
                type="number"
                min={0}
                value={keepMonthly}
                onChange={(e) => setKeepMonthly(Number(e.target.value))}
              />
            </Field>
            <Field label="Keep yearly">
              <input
                className="input mono"
                type="number"
                min={0}
                value={keepYearly}
                onChange={(e) => setKeepYearly(Number(e.target.value))}
              />
            </Field>
          </div>
          <div
            className="muted mono"
            style={{ fontSize: 11, padding: "6px 0", color: "var(--fg-3)" }}
          >
            forget-policy: keep last {keepDaily} daily, {keepWeekly} weekly, {keepMonthly} monthly,{" "}
            {keepYearly} yearly
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <Field label="Destination">
            <select
              className="input"
              value={destination}
              onChange={(e) => setDestination(e.target.value as DestinationId)}
            >
              {DESTINATIONS.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Encryption">
            <select
              className="input"
              value={encryption}
              onChange={(e) => setEncryption(e.target.value as EncryptionMode)}
            >
              <option value="KMS-managed">KMS-managed</option>
              <option value="AES-256 GCM">AES-256 GCM</option>
              <option value="customer-key">Customer-managed key</option>
              <option value="none">None (not recommended)</option>
            </select>
          </Field>
        </div>

        <Field label="Pre-backup hook (optional)">
          <input
            className="input mono"
            placeholder="e.g. systemctl stop postgres-prewarm"
            value={hook}
            onChange={(e) => setHook(e.target.value)}
          />
        </Field>

        <Field label="Notification channel">
          <select className="input" value={notify} onChange={(e) => setNotify(e.target.value)}>
            <option value="ops-alerts">#ops-alerts (Slack)</option>
            <option value="email-admins">email · admins@paperhouse.dev</option>
            <option value="webhook">Webhook · ops-router</option>
            <option value="none">No notifications</option>
          </select>
        </Field>
      </div>
    </ModalShell>
  );
}

// ────────── Restore wizard ──────────
function RestoreWizard({ backup, onClose }: { backup: Backup; onClose: () => void }) {
  const [step, setStep] = useState<0 | 1 | 2>(0);
  const [target, setTarget] = useState<RestoreTarget>("as-new");
  const [newName, setNewName] = useState(`${backup.source}-restored`);
  const [newProject, setNewProject] = useState<string>(backup.project);
  const [confirm, setConfirm] = useState("");

  const requiresTyped = target === "in-place";
  const typedOk = !requiresTyped || confirm === backup.source;

  return (
    <ModalShell
      title={`Restore · ${backup.source}`}
      subtitle={`Backup ${backup.id} · ${backup.whenAbs}`}
      onClose={onClose}
      width={620}
      footer={
        <>
          <div className="muted" style={{ fontSize: 11 }}>
            Step {step + 1} of 3
          </div>
          <div style={{ flex: 1 }} />
          {step > 0 && (
            <button className="btn" onClick={() => setStep((step - 1) as 0 | 1)}>
              Back
            </button>
          )}
          {step < 2 && (
            <button className="btn primary" onClick={() => setStep((step + 1) as 1 | 2)}>
              Continue
            </button>
          )}
          {step === 2 && target === "download" && (
            <button className="btn primary" onClick={onClose}>
              <I.download width={11} height={11} /> Download
            </button>
          )}
          {step === 2 && target !== "download" && (
            <button
              className="btn"
              disabled={!typedOk}
              onClick={onClose}
              style={
                target === "in-place"
                  ? {
                      background: "var(--err)",
                      color: "white",
                      borderColor: "var(--err)",
                      opacity: typedOk ? 1 : 0.4,
                    }
                  : { opacity: typedOk ? 1 : 0.4 }
              }
            >
              <I.refresh width={11} height={11} />{" "}
              {target === "in-place" ? "Restore in place" : "Restore as new"}
            </button>
          )}
        </>
      }
    >
      <div className="row gap-1" style={{ marginBottom: 18 }}>
        {(["Choose target", "Verify", "Confirm"] as const).map((s, i) => (
          <div key={s} className="row gap-2" style={{ flex: 1 }}>
            <span
              style={{
                width: 22,
                height: 22,
                borderRadius: "50%",
                background: i <= step ? "var(--fg)" : "var(--bg-overlay)",
                color: i <= step ? "var(--bg)" : "var(--fg-3)",
                display: "grid",
                placeItems: "center",
                fontSize: 11,
                fontWeight: 600,
              }}
            >
              {i + 1}
            </span>
            <span style={{ fontSize: 12, color: i === step ? "var(--fg)" : "var(--fg-3)" }}>
              {s}
            </span>
            {i < 2 && (
              <div style={{ flex: 1, height: 1, background: "var(--border)", marginRight: 4 }} />
            )}
          </div>
        ))}
      </div>

      {step === 0 && (
        <div className="col gap-3">
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
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 10,
                marginTop: 4,
              }}
            >
              <Field label="New name">
                <input
                  className="input mono"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                />
              </Field>
              <Field label="Project">
                <select
                  className="input"
                  value={newProject}
                  onChange={(e) => setNewProject(e.target.value)}
                >
                  {PROJECTS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          )}
        </div>
      )}

      {step === 1 && (
        <div className="col gap-3">
          <div className="muted" style={{ fontSize: 12 }}>
            Verify the snapshot integrity and review the source ↔ target diff before continuing.
          </div>
          <div
            style={{
              border: "1px solid var(--border)",
              borderRadius: 6,
              padding: 12,
              background: "var(--bg-sunken)",
            }}
          >
            <div className="row gap-2" style={{ marginBottom: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 600 }}>Integrity check</span>
              <div style={{ flex: 1 }} />
              <span className="badge ok">
                <span className="dot" />
                checksum match
              </span>
            </div>
            <div className="mono muted" style={{ fontSize: 11 }}>
              sha256 ok · {backup.checksum.slice(0, 24)}…
            </div>
            <div className="mono muted" style={{ fontSize: 11, marginTop: 2 }}>
              encryption: {backup.encryption}
            </div>
          </div>

          <div
            style={{
              border: "1px solid var(--border)",
              borderRadius: 6,
              overflow: "hidden",
            }}
          >
            <div
              className="row gap-2"
              style={{
                padding: "8px 12px",
                background: "var(--bg-sunken)",
                borderBottom: "1px solid var(--border)",
              }}
            >
              <span style={{ fontSize: 12, fontWeight: 600 }}>Source ↔ target diff</span>
            </div>
            <div className="mono" style={{ fontSize: 11, padding: 12, lineHeight: 1.7 }}>
              <div style={{ color: "var(--fg-3)" }}>--- source: {backup.sourceService}</div>
              <div style={{ color: "var(--fg-3)" }}>
                +++ target:{" "}
                {target === "in-place"
                  ? backup.source
                  : target === "as-new"
                    ? newName
                    : "(download only)"}
              </div>
              <div style={{ color: "var(--ok)" }}>+ size: {fmtSize(backup.sourceSizeMB)}</div>
              <div style={{ color: "var(--ok)" }}>+ method: {backup.method}</div>
              <div style={{ color: "var(--warn)" }}>~ retention class: {backup.retention}</div>
              {target === "in-place" && (
                <div style={{ color: "var(--err)" }}>
                  - existing data on {backup.source} will be replaced
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="col gap-3">
          {target === "download" && (
            <div
              style={{
                background: "var(--info-bg)",
                border: "1px solid color-mix(in srgb, var(--info) 30%, transparent)",
                borderRadius: 6,
                padding: 14,
              }}
            >
              <div className="row gap-2" style={{ marginBottom: 6 }}>
                <I.download width={14} height={14} style={{ color: "var(--info)" }} />
                <span style={{ fontSize: 13, fontWeight: 600, color: "var(--info)" }}>
                  Download presigned URL
                </span>
              </div>
              <code
                className="mono"
                style={{
                  fontSize: 11,
                  display: "block",
                  background: "var(--bg-elev)",
                  padding: 8,
                  borderRadius: 4,
                  wordBreak: "break-all",
                  color: "var(--fg-2)",
                }}
              >
                https://helio-backups.local/{backup.id}.tgz?X-Amz-Expires=3600&X-Amz-Signature=…
              </code>
              <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>
                URL is valid for 60 minutes. We will not record this download against retention.
              </div>
            </div>
          )}
          {target === "as-new" && (
            <div
              style={{
                background: "var(--ok-bg)",
                border: "1px solid color-mix(in srgb, var(--ok) 30%, transparent)",
                borderRadius: 6,
                padding: 14,
              }}
            >
              <div className="row gap-2" style={{ marginBottom: 4 }}>
                <I.check width={14} height={14} style={{ color: "var(--ok)" }} />
                <span style={{ fontSize: 13, fontWeight: 600, color: "var(--ok)" }}>
                  Safe restore
                </span>
              </div>
              <div className="muted" style={{ fontSize: 12 }}>
                A new service named <span className="mono">{newName}</span> will be created in
                project <b>{newProject}</b>. Nothing existing will change.
              </div>
            </div>
          )}
          {target === "in-place" && (
            <>
              <div
                style={{
                  background: "var(--err-bg)",
                  border: "1px solid color-mix(in srgb, var(--err) 35%, transparent)",
                  borderRadius: 6,
                  padding: 14,
                }}
              >
                <div className="row gap-2" style={{ marginBottom: 6 }}>
                  <I.warning width={14} height={14} style={{ color: "var(--err)" }} />
                  <span style={{ fontSize: 13, fontWeight: 600, color: "var(--err)" }}>
                    Destructive action
                  </span>
                </div>
                <div style={{ fontSize: 12, color: "var(--fg-2)" }}>
                  This will overwrite all current data on{" "}
                  <span className="mono" style={{ color: "var(--err)" }}>
                    {backup.source}
                  </span>{" "}
                  with snapshot <span className="mono">{backup.id}</span>. The current state cannot
                  be recovered unless a separate snapshot exists.
                </div>
              </div>
              <Field label={`Type the name "${backup.source}" to confirm`}>
                <input
                  className="input mono"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder={backup.source}
                  autoFocus
                />
              </Field>
              {!typedOk && confirm.length > 0 && (
                <div className="mono" style={{ fontSize: 11, color: "var(--err)" }}>
                  Typed name does not match.
                </div>
              )}
            </>
          )}
        </div>
      )}
    </ModalShell>
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
      style={{
        textAlign: "left",
        padding: 14,
        border: `1px solid ${active ? (danger ? "var(--err)" : "var(--fg)") : "var(--border)"}`,
        borderRadius: 8,
        background: active ? "var(--bg-overlay)" : "var(--bg)",
        cursor: "pointer",
        color: "var(--fg)",
      }}
    >
      <div className="row gap-2">
        <span style={{ fontWeight: 600, fontSize: 13, color: danger ? "var(--err)" : "var(--fg)" }}>
          {title}
        </span>
        {danger && (
          <span
            className="badge"
            style={{ background: "var(--err-bg)", color: "var(--err)", fontSize: 10 }}
          >
            destructive
          </span>
        )}
      </div>
      <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
        {sub}
      </div>
    </button>
  );
}
