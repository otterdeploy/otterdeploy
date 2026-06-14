// Mock constants ported verbatim from apps/web-demo/src/features/otterdeploy/data.ts.
// Pass A — no oRPC wiring. These are the source of truth for the engine picker UI.

export interface ServiceKind {
  id: string;
  name: string;
  sub: string;
  icon: string;
  group: "compute" | "data" | "custom";
  examples?: string;
  versions?: string[];
}

export const SERVICE_KINDS: ServiceKind[] = [
  {
    id: "app",
    name: "Web app",
    sub: "HTTP service · auto-scaled · public route",
    icon: "globe",
    group: "compute",
    examples: "Next.js · Rails · Django · Express · Laravel",
  },
  {
    id: "worker",
    name: "Background worker",
    sub: "Long-running process · no port · processes a queue",
    icon: "service",
    group: "compute",
    examples: "Sidekiq · Celery · BullMQ · Resque",
  },
  {
    id: "cron",
    name: "Scheduled job",
    sub: "Run a command on a cron schedule",
    icon: "clock",
    group: "compute",
    examples: "nightly migrations · weekly reports · TTL cleanup",
  },
  {
    id: "static",
    name: "Static site",
    sub: "Pre-built HTML/CSS/JS served from edge",
    icon: "doc",
    group: "compute",
    examples: "Vite · Astro · Next export · plain HTML",
  },
  {
    id: "function",
    name: "One-off function",
    sub: "Triggered manually or via webhook · auto-shuts down",
    icon: "bolt",
    group: "compute",
    examples: "data import · webhook handler · seed script",
  },
  {
    id: "postgres",
    name: "PostgreSQL",
    sub: "Managed Postgres · daily backups · PITR optional",
    icon: "db",
    group: "data",
    versions: ["18", "17"],
  },
  {
    id: "mariadb",
    name: "MariaDB",
    sub: "MySQL-compatible · drop-in replacement",
    icon: "db",
    group: "data",
    versions: ["11.4", "11.2", "10.11"],
  },
  {
    id: "redis",
    name: "Redis",
    sub: "In-memory cache · pub/sub · streams",
    icon: "db",
    group: "data",
    versions: ["7.4", "7.2", "6.2"],
  },
  {
    id: "mongodb",
    name: "MongoDB",
    sub: "Document store · replica set",
    icon: "db",
    group: "data",
    versions: ["7.0", "6.0", "5.0"],
  },
  {
    id: "clickhouse",
    name: "ClickHouse",
    sub: "Columnar analytics database",
    icon: "db",
    group: "data",
    versions: ["24.8", "24.3", "23.8"],
  },
  {
    id: "rabbitmq",
    name: "RabbitMQ",
    sub: "AMQP message broker",
    icon: "service",
    group: "data",
    versions: ["3.13", "3.12"],
  },
  {
    id: "minio",
    name: "MinIO",
    sub: "S3-compatible object storage",
    icon: "folder",
    group: "data",
    versions: ["latest", "2024-08"],
  },
  {
    id: "meilisearch",
    name: "Meilisearch",
    sub: "Typo-tolerant full-text search",
    icon: "service",
    group: "data",
    versions: ["1.10", "1.9"],
  },
  {
    id: "docker",
    name: "Custom Docker image",
    sub: "Pull any OCI image · point at registry",
    icon: "service",
    group: "custom",
  },
  {
    id: "compose",
    name: "Docker Compose",
    sub: "Import a compose.yml · multi-service project",
    icon: "doc",
    group: "custom",
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

export const TEMPLATES: Template[] = [
  {
    id: "t-medusa",
    name: "Medusa Commerce",
    sub: "Headless commerce · Medusa + Postgres + Redis + admin",
    services: 4,
    popular: true,
    icon: "service",
  },
  {
    id: "t-supabase",
    name: "Supabase",
    sub: "Auth · Postgres · Realtime · Storage · Studio",
    services: 6,
    popular: true,
    icon: "db",
  },
  {
    id: "t-strapi",
    name: "Strapi CMS",
    sub: "Headless CMS + Postgres",
    services: 2,
    icon: "doc",
  },
  {
    id: "t-ghost",
    name: "Ghost",
    sub: "Publishing platform · Ghost + MySQL",
    services: 2,
    icon: "doc",
  },
  {
    id: "t-nocodb",
    name: "NocoDB",
    sub: "Airtable alternative · NocoDB + Postgres",
    services: 2,
    icon: "db",
  },
  {
    id: "t-plausible",
    name: "Plausible Analytics",
    sub: "Plausible + ClickHouse + Postgres",
    services: 3,
    icon: "metrics",
  },
  {
    id: "t-umami",
    name: "Umami",
    sub: "Privacy-focused analytics + Postgres",
    services: 2,
    icon: "metrics",
  },
  {
    id: "t-n8n",
    name: "n8n",
    sub: "Workflow automation",
    services: 1,
    icon: "bolt",
  },
  {
    id: "t-grafana",
    name: "Grafana + Prometheus",
    sub: "Observability stack",
    services: 3,
    icon: "metrics",
  },
  {
    id: "t-langfuse",
    name: "Langfuse",
    sub: "LLM observability + Postgres + ClickHouse",
    services: 3,
    icon: "metrics",
  },
];

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

export const BUILDERS: Builder[] = [
  {
    id: "railpack",
    name: "Railpack",
    sub: "Auto-detect — Node, Python, Go, Rust, Ruby…",
    icon: "bolt",
    popular: true,
    langs: ["node", "python", "go", "rust", "ruby", "php", "elixir"],
  },
  {
    id: "dockerfile",
    name: "Dockerfile",
    sub: "Use the Dockerfile in your repo",
    icon: "doc",
  },
  {
    id: "compose",
    name: "Docker Compose",
    sub: "Multi-container from compose.yml",
    icon: "service",
  },
  {
    id: "buildpack",
    name: "Buildpacks",
    sub: "CNB / Heroku-style cloud-native buildpacks",
    icon: "folder",
  },
  {
    id: "static",
    name: "Static site",
    sub: "Plain HTML / Vite / Astro / Next export",
    icon: "globe",
  },
];
