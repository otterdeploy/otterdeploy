// Mock constants ported verbatim from apps/web-demo/src/features/otterdeploy/data.ts.
// Pass A — no oRPC wiring. These are the source of truth for the engine picker UI.

export interface ServiceKind {
  id: string;
  name: string;
  sub: string;
  icon: string;
  /** Tab the card lives under — keyed to *where the artifact comes from*,
   *  which is exactly what the create wizard branches on:
   *   - source   → build from a Git repo (apps, workers, jobs, static)
   *   - image    → pull a prebuilt OCI image / compose file
   *   - database → managed stateful services */
  group: "source" | "image" | "database";
  examples?: string;
  versions?: string[];
  /** Card is shown but not selectable — the provisioner isn't wired yet.
   *  Gates roadmap kinds behind a "Coming soon" chip instead of letting
   *  the operator click through to a dead-end Review step. */
  comingSoon?: boolean;
  /** A long-running compute service with no HTTP port (a background worker).
   *  Skips the Networking step and is created with no published port / no
   *  public route — the swarm spec omits the EndpointSpec entirely. */
  portless?: boolean;
}

export const SERVICE_KINDS: ServiceKind[] = [
  {
    id: "app",
    name: "Web app",
    sub: "HTTP service · auto-scaled · public route",
    icon: "globe",
    group: "source",
    examples: "Next.js · Rails · Django · Express · Laravel",
  },
  {
    id: "worker",
    name: "Background worker",
    sub: "Long-running process · no port · processes a queue",
    icon: "service",
    group: "source",
    examples: "Sidekiq · Celery · BullMQ · Resque",
    portless: true,
  },
  {
    // Needs a scheduler the platform doesn't have yet (swarm has no native
    // cron) — gated until that lands rather than creating a job nothing fires.
    id: "cron",
    name: "Scheduled job",
    sub: "Run a command on a cron schedule",
    icon: "clock",
    group: "source",
    examples: "nightly migrations · weekly reports · TTL cleanup",
    comingSoon: true,
  },
  {
    id: "static",
    name: "Static site",
    sub: "Pre-built HTML/CSS/JS served from edge",
    icon: "doc",
    group: "source",
    examples: "Vite · Astro · Next export · plain HTML",
  },
  {
    // "Auto-shuts down" needs RestartPolicy:none + run-to-completion tracking
    // the runtime driver doesn't model yet — gated until that lands.
    id: "function",
    name: "One-off function",
    sub: "Triggered manually or via webhook · auto-shuts down",
    icon: "bolt",
    group: "source",
    examples: "data import · webhook handler · seed script",
    comingSoon: true,
  },
  {
    id: "postgres",
    name: "PostgreSQL",
    sub: "Managed Postgres · daily backups · PITR optional",
    icon: "db",
    group: "database",
    versions: ["18", "17"],
  },
  {
    id: "mariadb",
    name: "MariaDB",
    sub: "MySQL-compatible · drop-in replacement",
    icon: "db",
    group: "database",
    versions: ["11.4", "11.2", "10.11"],
  },
  {
    id: "redis",
    name: "Redis",
    sub: "In-memory cache · pub/sub · streams",
    icon: "db",
    group: "database",
    versions: ["7.4", "7.2", "6.2"],
  },
  {
    id: "mongodb",
    name: "MongoDB",
    sub: "Document store · replica set",
    icon: "db",
    group: "database",
    versions: ["7.0", "6.0", "5.0"],
  },
  {
    id: "clickhouse",
    name: "ClickHouse",
    sub: "Columnar analytics database",
    icon: "db",
    group: "database",
    versions: ["24.8", "24.3", "23.8"],
  },
  {
    id: "rabbitmq",
    name: "RabbitMQ",
    sub: "AMQP message broker",
    icon: "service",
    group: "database",
    versions: ["3.13", "3.12"],
  },
  {
    id: "minio",
    name: "MinIO",
    sub: "S3-compatible object storage",
    icon: "folder",
    group: "database",
    versions: ["latest"],
  },
  {
    id: "meilisearch",
    name: "Meilisearch",
    sub: "Typo-tolerant full-text search",
    icon: "service",
    group: "database",
    versions: ["v1.10", "v1.9"],
  },
  {
    id: "docker",
    name: "Custom Docker image",
    sub: "Pull any OCI image · point at registry",
    icon: "service",
    group: "image",
  },
  {
    id: "compose",
    name: "Docker Compose",
    sub: "Import a compose.yml · multi-service project",
    icon: "doc",
    group: "image",
  },
];

/**
 * Top-level "what do you want to launch" cards on the wizard's first step.
 * Source-first: each card is a *source/category*, not a workload role — the
 * role (web app vs static vs worker) is a downstream field, since the same
 * role can come from git, an image, or compose. `git`/`image` are terminal
 * (they set `kindId` directly); `database` drills into an engine sub-picker.
 */
export interface LaunchCategory {
  id: "git" | "image" | "database" | "compose" | "template" | "empty";
  name: string;
  sub: string;
  /** kindId selected when the card is terminal. Omitted for `database`
   *  (engine chosen in the sub-picker) and coming-soon cards. */
  kindId?: string;
  /** Shown but not selectable — provisioner isn't wired yet. */
  comingSoon?: boolean;
}

export const LAUNCH_CATEGORIES: LaunchCategory[] = [
  { id: "git", name: "GitHub repo", sub: "Build from a Git ref", kindId: "app" },
  {
    id: "image",
    name: "Docker image",
    sub: "Pull an image from a registry",
    kindId: "docker",
  },
  {
    id: "database",
    name: "Create database",
    sub: "Postgres, MariaDB, Redis, MongoDB and more",
  },
  {
    id: "compose",
    name: "Docker Compose",
    sub: "Import a compose.yml or paste a stack file",
    kindId: "compose",
  },
  {
    id: "template",
    name: "From template",
    sub: "Launch a curated multi-service stack",
    comingSoon: true,
  },
  {
    id: "empty",
    name: "Empty service",
    sub: "Start from a blank compute service",
    comingSoon: true,
  },
];

export interface Template {
  id: string;
  name: string;
  sub: string;
  services: number;
  popular?: boolean;
  icon: string;
}



export interface ResourcePreset {
  id: string;
  name: string;
  cpu: number | null;
  mem: number | null;
  sub: string;
  popular?: boolean;
}

export const RESOURCE_PRESETS: ResourcePreset[] = [
  {
    id: "micro",
    name: "Micro",
    cpu: 0.25,
    mem: 256,
    sub: "dev / preview / cron",
  },
  {
    id: "small",
    name: "Small",
    cpu: 0.5,
    mem: 512,
    sub: "small workers · static · staging api",
    popular: true,
  },
  {
    id: "medium",
    name: "Medium",
    cpu: 1,
    mem: 1024,
    sub: "most production web apps",
  },
  {
    id: "large",
    name: "Large",
    cpu: 2,
    mem: 2048,
    sub: "high-traffic api · workers under load",
  },
  {
    id: "xl",
    name: "XL",
    cpu: 4,
    mem: 4096,
    sub: "database primary · heavy compute",
  },
  {
    id: "custom",
    name: "Custom",
    cpu: null,
    mem: null,
    sub: "tune CPU and RAM independently",
  },
];

export type NodeRole = "manager" | "worker";
export type NodeStatus = "ready" | "draining" | "down";
export type NodeAvailability = "active" | "drain" | "pause";

export interface Node {
  id: string;
  name: string;
  region: string;
  host: string;
  cpu: { used: number; total: number };
  mem: { used: number; total: number };
  disk?: { used: number; total: number; unit: string };
  services: number;
  status: NodeStatus;
  role: NodeRole;
  availability: NodeAvailability;
  joined: string;
  daemonVersion: string;
  labels?: string[];
  project?: string;
}

export interface Builder {
  id: string;
  name: string;
  sub: string;
  icon: string;
  popular?: boolean;
  langs?: string[];
}


