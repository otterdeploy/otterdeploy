// Otterstack design data — ported 1:1 from /tmp/anth-design-qP3sS7/otterstack/project/data.jsx
// All shapes match the prototype so screens can drive directly off it.

export type ServiceKind = "service" | "database";
export type ServiceStatus = "healthy" | "degraded" | "down";
export type Env = "production" | "staging" | "preview";
export type DeployStatus = "live" | "rolled-back" | "failed" | "building" | "queued";

export interface Service {
  id: string;
  name: string;
  kind: ServiceKind;
  repo?: string;
  branch?: string;
  framework?: string;
  image: string;
  domain?: string | null;
  port: number | null;
  replicas: number;
  status: ServiceStatus;
  cpu: number;
  mem: number;
  pos: { x: number; y: number };
  deploys?: number;
  lastDeploy?: string;
  commit?: string;
  commitMsg?: string;
  author?: string;
  storage?: { used: number; total: number; unit: string };
  version?: string;
  /** Owner project. Cross-project consumers reach this resource over internal DNS. */
  project?: string;
}

export const PROJECT = {
  name: "helio",
  team: "paperhouse",
  region: "sf-bay / rack-2",
  envs: ["production", "staging", "preview"] as const satisfies readonly Env[],
};

export interface ProjectRef { id: string; name: string; color: string }

// Multi-tenant project catalog — many projects can share the same swarm.
// Tags below cross-reference these ids.
export const PROJECTS: ProjectRef[] = [
  { id: "helio", name: "helio", color: "#60a5fa" },
  { id: "billing", name: "billing", color: "#fbbf24" },
  { id: "marketing", name: "marketing-site", color: "#4ade80" },
  { id: "internal", name: "internal-tools", color: "#f472b6" },
];

export const SERVICES: Service[] = [
  {
    id: "web",
    name: "web",
    kind: "service",
    repo: "paperhouse/helio-web",
    branch: "main",
    framework: "Next.js 14",
    image: "node:20-alpine",
    domain: "helio.so",
    port: 3000,
    replicas: 3,
    status: "healthy",
    cpu: 0.34,
    mem: 0.62,
    pos: { x: 80, y: 220 },
    deploys: 142,
    lastDeploy: "4m ago",
    commit: "8a2c1f9",
    commitMsg: "fix: skeleton flash on /pricing",
    author: "mira",
    project: "helio",
  },
  {
    id: "api",
    name: "api",
    kind: "service",
    repo: "paperhouse/helio-api",
    branch: "main",
    framework: "Node / Fastify",
    image: "node:20-alpine",
    domain: "api.helio.so",
    port: 8080,
    replicas: 4,
    status: "healthy",
    cpu: 0.51,
    mem: 0.48,
    pos: { x: 380, y: 140 },
    deploys: 318,
    lastDeploy: "11m ago",
    commit: "3f9b042",
    commitMsg: "feat: idempotency keys on /v1/charges",
    author: "arjun",
    project: "helio",
  },
  {
    id: "worker",
    name: "worker",
    kind: "service",
    repo: "paperhouse/helio-worker",
    branch: "main",
    framework: "Python 3.12",
    image: "python:3.12-slim",
    domain: null,
    port: null,
    replicas: 2,
    status: "degraded",
    cpu: 0.78,
    mem: 0.71,
    pos: { x: 380, y: 340 },
    deploys: 87,
    lastDeploy: "38m ago",
    commit: "c1ad5e2",
    commitMsg: "chore: bump celery to 5.4",
    author: "mira",
    project: "helio",
  },
  {
    id: "postgres",
    name: "postgres",
    kind: "database",
    image: "postgres:16",
    domain: null,
    port: 5432,
    replicas: 1,
    status: "healthy",
    cpu: 0.22,
    mem: 0.55,
    storage: { used: 12.4, total: 50, unit: "GB" },
    pos: { x: 700, y: 100 },
    version: "16.2",
    project: "helio",
  },
  {
    id: "redis",
    name: "redis",
    kind: "database",
    image: "redis:7",
    domain: null,
    port: 6379,
    replicas: 1,
    status: "healthy",
    cpu: 0.08,
    mem: 0.18,
    storage: { used: 0.12, total: 1, unit: "GB" },
    pos: { x: 700, y: 280 },
    version: "7.2",
    project: "helio",
  },
  {
    id: "imgproxy",
    name: "imgproxy",
    kind: "service",
    image: "darthsim/imgproxy:v3",
    domain: "img.helio.so",
    port: 8081,
    replicas: 1,
    status: "healthy",
    cpu: 0.12,
    mem: 0.2,
    pos: { x: 700, y: 440 },
    deploys: 4,
    lastDeploy: "12d ago",
    project: "helio",
  },
];

export interface Edge { from: string; to: string; kind: "http" | "tcp" | "queue"; rps: number }

export const EDGES: Edge[] = [
  { from: "web", to: "api", kind: "http", rps: 184 },
  { from: "web", to: "imgproxy", kind: "http", rps: 42 },
  { from: "api", to: "postgres", kind: "tcp", rps: 312 },
  { from: "api", to: "redis", kind: "tcp", rps: 980 },
  { from: "api", to: "worker", kind: "queue", rps: 26 },
  { from: "worker", to: "postgres", kind: "tcp", rps: 18 },
  { from: "worker", to: "redis", kind: "tcp", rps: 64 },
];

export interface EnvVar { k: string; v: string; secret: boolean; ref?: string }

export const ENV_VARS: Record<string, EnvVar[]> = {
  api: [
    { k: "DATABASE_URL", v: "postgres://helio:••••••@postgres:5432/helio", secret: true, ref: "postgres" },
    { k: "REDIS_URL", v: "redis://redis:6379", secret: false, ref: "redis" },
    { k: "JWT_SECRET", v: "••••••••••••••••••••••", secret: true },
    { k: "STRIPE_SECRET_KEY", v: "sk_live_••••••••", secret: true },
    { k: "PORT", v: "8080", secret: false },
    { k: "NODE_ENV", v: "production", secret: false },
    { k: "LOG_LEVEL", v: "info", secret: false },
    { k: "SENTRY_DSN", v: "https://••••@sentry.io/4504", secret: true },
  ],
  web: [
    { k: "NEXT_PUBLIC_API_URL", v: "https://api.helio.so", secret: false },
    { k: "NEXT_PUBLIC_POSTHOG_KEY", v: "phc_••••••", secret: true },
    { k: "REVALIDATE_SECRET", v: "••••••", secret: true },
  ],
  worker: [
    { k: "DATABASE_URL", v: "postgres://helio:••••••@postgres:5432/helio", secret: true, ref: "postgres" },
    { k: "REDIS_URL", v: "redis://redis:6379", secret: false, ref: "redis" },
    { k: "CONCURRENCY", v: "8", secret: false },
  ],
};

export interface Deployment {
  id: string;
  service: string;
  status: DeployStatus;
  commit: string;
  msg: string;
  author: string;
  when: string;
  dur: string;
  env: Env;
}

export const DEPLOYMENTS: Deployment[] = [
  { id: "d_8a2c1f9", service: "web", status: "live", commit: "8a2c1f9", msg: "fix: skeleton flash on /pricing", author: "mira", when: "4m ago", dur: "1m 12s", env: "production" },
  { id: "d_3f9b042", service: "api", status: "live", commit: "3f9b042", msg: "feat: idempotency keys on /v1/charges", author: "arjun", when: "11m ago", dur: "2m 41s", env: "production" },
  { id: "d_c1ad5e2", service: "worker", status: "live", commit: "c1ad5e2", msg: "chore: bump celery to 5.4", author: "mira", when: "38m ago", dur: "3m 02s", env: "production" },
  { id: "d_71fa0c3", service: "api", status: "rolled-back", commit: "71fa0c3", msg: "wip: pg pool tweaks", author: "arjun", when: "2h ago", dur: "1m 58s", env: "production" },
  { id: "d_5b2e8d1", service: "web", status: "live", commit: "5b2e8d1", msg: "feat: announcement bar", author: "eli", when: "5h ago", dur: "1m 06s", env: "production" },
  { id: "d_e042bb1", service: "web", status: "live", commit: "e042bb1", msg: "feat: pricing tier copy", author: "mira", when: "1d ago", dur: "1m 14s", env: "staging" },
  { id: "d_fe19a02", service: "api", status: "failed", commit: "fe19a02", msg: "try: bun runtime", author: "arjun", when: "2d ago", dur: "0m 47s", env: "preview" },
];

export interface Domain { host: string; service: string; port: number; tls: string; status: string }

export const DOMAINS: Domain[] = [
  { host: "helio.so", service: "web", port: 3000, tls: "letsencrypt", status: "active" },
  { host: "www.helio.so", service: "web", port: 3000, tls: "letsencrypt", status: "active" },
  { host: "api.helio.so", service: "api", port: 8080, tls: "letsencrypt", status: "active" },
  { host: "img.helio.so", service: "imgproxy", port: 8081, tls: "letsencrypt", status: "active" },
  { host: "staging.helio.so", service: "web", port: 3000, tls: "letsencrypt", status: "active" },
];

export const rid = () => Math.random().toString(36).slice(2, 8);
export const rint = (a: number, b: number) => Math.floor(Math.random() * (b - a) + a);
export const ts = () => {
  const d = new Date();
  return d.toTimeString().slice(0, 8) + "." + String(d.getMilliseconds()).padStart(3, "0");
};

export const LOG_TEMPLATES: Record<string, Array<() => string>> = {
  api: [
    () => `${ts()} [info] GET /v1/users/${rid()} 200 ${rint(8, 42)}ms`,
    () => `${ts()} [info] POST /v1/charges 201 ${rint(80, 220)}ms idem=${rid()}`,
    () => `${ts()} [info] GET /healthz 200 1ms`,
    () => `${ts()} [info] cache hit user:${rid()}`,
    () => `${ts()} [warn] slow query 412ms SELECT * FROM events WHERE …`,
    () => `${ts()} [info] queue.publish charge.processed → worker`,
    () => `${ts()} [info] GET /v1/teams/${rid()}/members 200 ${rint(12, 60)}ms`,
  ],
  web: [
    () => `${ts()} ▲ Next ready on :3000`,
    () => `${ts()} GET / 200 ${rint(20, 80)}ms`,
    () => `${ts()} GET /pricing 200 ${rint(30, 90)}ms`,
    () => `${ts()} GET /_next/static/chunks/${rid()}.js 200`,
    () => `${ts()} ISR revalidated /blog/why-helio`,
  ],
  worker: [
    () => `${ts()} [worker] picked up task charge.processed#${rid()}`,
    () => `${ts()} [worker] task done in ${rint(80, 600)}ms`,
    () => `${ts()} [worker] retrying webhook.deliver attempt 2/5`,
    () => `${ts()} [worker] heartbeat`,
  ],
};

export const USER = {
  name: "Mira Sato",
  email: "mira@paperhouse.dev",
  initials: "MS",
  role: "admin" as const,
  org: "paperhouse",
  orgs: ["paperhouse", "mira-personal", "helio-labs"],
};

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  initials: string;
  role: "admin" | "developer" | "viewer";
  last: string;
  mfa: boolean;
  you?: boolean;
}

export const TEAM: TeamMember[] = [
  { id: "t_mira", name: "Mira Sato", email: "mira@paperhouse.dev", initials: "MS", role: "admin", last: "now", mfa: true, you: true },
  { id: "t_arjun", name: "Arjun Patel", email: "arjun@paperhouse.dev", initials: "AP", role: "admin", last: "2h ago", mfa: true },
  { id: "t_lin", name: "Lin Wang", email: "lin@paperhouse.dev", initials: "LW", role: "developer", last: "1d ago", mfa: true },
  { id: "t_kai", name: "Kai Robinson", email: "kai@paperhouse.dev", initials: "KR", role: "developer", last: "3d ago", mfa: false },
  { id: "t_dev", name: "Devika Rao", email: "devika@paperhouse.dev", initials: "DR", role: "viewer", last: "12d ago", mfa: true },
];

export interface SyncProvider {
  id: string;
  name: string;
  sub: string;
  connected: boolean;
  last?: string;
  count?: number;
  env?: Env;
}

export const SYNC_PROVIDERS: SyncProvider[] = [
  { id: "infisical", name: "Infisical", sub: "Open-source secret manager", connected: true, last: "2m ago", count: 17, env: "production" },
  { id: "vault", name: "HashiCorp Vault", sub: "Self-hosted, dynamic secrets", connected: false },
  { id: "aws-sm", name: "AWS Secrets Manager", sub: "KMS-backed cloud secrets", connected: false },
  { id: "doppler", name: "Doppler", sub: "SaaS secret platform", connected: true, last: "1h ago", count: 12, env: "staging" },
  { id: "1password", name: "1Password Connect", sub: "Vault-based, audit-friendly", connected: false },
  { id: "gcp-sm", name: "Google Secret Manager", sub: "GCP-native", connected: false },
];

export interface Builder { id: string; name: string; sub: string; icon: string; popular?: boolean; langs?: string[] }

export const BUILDERS: Builder[] = [
  { id: "railpack", name: "Railpack", sub: "Auto-detect — Node, Python, Go, Rust, Ruby…", icon: "bolt", popular: true, langs: ["node", "python", "go", "rust", "ruby", "php", "elixir"] },
  { id: "dockerfile", name: "Dockerfile", sub: "Use the Dockerfile in your repo", icon: "doc" },
  { id: "compose", name: "Docker Compose", sub: "Multi-container from compose.yml", icon: "service" },
  { id: "buildpack", name: "Buildpacks", sub: "CNB / Heroku-style cloud-native buildpacks", icon: "folder" },
  { id: "nixpack", name: "Nixpacks", sub: "Reproducible Nix-derived images", icon: "graph" },
  { id: "static", name: "Static site", sub: "Plain HTML / Vite / Astro / Next export", icon: "globe" },
];

export interface EnvOverviewKey {
  k: string;
  secret: boolean;
  status: { production: "set" | "missing" | "empty"; staging: "set" | "missing" | "empty"; preview: "set" | "missing" | "empty" };
}

export const ENV_OVERVIEW_KEYS: EnvOverviewKey[] = [
  { k: "ADMIN_ALLOWED_EMAILS", secret: false, status: { production: "empty", staging: "empty", preview: "empty" } },
  { k: "APPLE_APP_BUNDLE_ID", secret: true, status: { production: "set", staging: "missing", preview: "missing" } },
  { k: "APPLE_CLIENT_ID", secret: false, status: { production: "empty", staging: "missing", preview: "missing" } },
  { k: "APPLE_KEY_ID", secret: false, status: { production: "empty", staging: "missing", preview: "missing" } },
  { k: "APPLE_PRIVATE_KEY", secret: true, status: { production: "empty", staging: "missing", preview: "missing" } },
  { k: "APPLE_TEAM_ID", secret: false, status: { production: "empty", staging: "missing", preview: "missing" } },
  { k: "BETTER_AUTH_SECRET", secret: true, status: { production: "set", staging: "missing", preview: "missing" } },
  { k: "BETTER_AUTH_URL", secret: true, status: { production: "set", staging: "missing", preview: "missing" } },
  { k: "CORS_ORIGIN", secret: true, status: { production: "set", staging: "missing", preview: "missing" } },
  { k: "DATABASE_URL", secret: true, status: { production: "set", staging: "set", preview: "set" } },
  { k: "GEMINI_API_KEY", secret: true, status: { production: "empty", staging: "missing", preview: "missing" } },
  { k: "GOOGLE_CLIENT_ID", secret: false, status: { production: "empty", staging: "missing", preview: "missing" } },
  { k: "GOOGLE_CLIENT_SECRET", secret: true, status: { production: "empty", staging: "missing", preview: "missing" } },
  { k: "MICROSOFT_CLIENT_ID", secret: false, status: { production: "empty", staging: "missing", preview: "missing" } },
  { k: "MICROSOFT_CLIENT_SECRET", secret: true, status: { production: "empty", staging: "missing", preview: "missing" } },
  { k: "OPENROUTER_API_KEY", secret: true, status: { production: "empty", staging: "missing", preview: "missing" } },
  { k: "VITE_SERVER_URL", secret: false, status: { production: "set", staging: "missing", preview: "missing" } },
];

export interface ServiceKindDef {
  id: string;
  name: string;
  sub: string;
  icon: string;
  group: "compute" | "data" | "custom";
  examples?: string;
  versions?: string[];
}

export const SERVICE_KINDS: ServiceKindDef[] = [
  { id: "app", name: "Web app", sub: "HTTP service · auto-scaled · public route", icon: "globe", group: "compute", examples: "Next.js · Rails · Django · Express · Laravel" },
  { id: "worker", name: "Background worker", sub: "Long-running process · no port · processes a queue", icon: "service", group: "compute", examples: "Sidekiq · Celery · BullMQ · Resque" },
  { id: "cron", name: "Scheduled job", sub: "Run a command on a cron schedule", icon: "clock", group: "compute", examples: "nightly migrations · weekly reports · TTL cleanup" },
  { id: "static", name: "Static site", sub: "Pre-built HTML/CSS/JS served from edge", icon: "doc", group: "compute", examples: "Vite · Astro · Next export · plain HTML" },
  { id: "function", name: "One-off function", sub: "Triggered manually or via webhook · auto-shuts down", icon: "bolt", group: "compute", examples: "data import · webhook handler · seed script" },
  { id: "postgres", name: "PostgreSQL", sub: "Managed Postgres · daily backups · PITR optional", icon: "db", group: "data", versions: ["16.4", "16.3", "15.8", "14.13"] },
  { id: "mysql", name: "MySQL", sub: "Managed MySQL with replication", icon: "db", group: "data", versions: ["8.4", "8.0", "5.7"] },
  { id: "redis", name: "Redis", sub: "In-memory cache · pub/sub · streams", icon: "db", group: "data", versions: ["7.4", "7.2", "6.2"] },
  { id: "mongodb", name: "MongoDB", sub: "Document store · replica set", icon: "db", group: "data", versions: ["7.0", "6.0", "5.0"] },
  { id: "clickhouse", name: "ClickHouse", sub: "Columnar analytics database", icon: "db", group: "data", versions: ["24.8", "24.3", "23.8"] },
  { id: "rabbitmq", name: "RabbitMQ", sub: "AMQP message broker", icon: "service", group: "data", versions: ["3.13", "3.12"] },
  { id: "minio", name: "MinIO", sub: "S3-compatible object storage", icon: "folder", group: "data", versions: ["latest", "2024-08"] },
  { id: "meilisearch", name: "Meilisearch", sub: "Typo-tolerant full-text search", icon: "service", group: "data", versions: ["1.10", "1.9"] },
  { id: "docker", name: "Custom Docker image", sub: "Pull any OCI image · point at registry", icon: "service", group: "custom" },
  { id: "compose", name: "Docker Compose", sub: "Import a compose.yml · multi-service project", icon: "doc", group: "custom" },
];

export interface Template { id: string; name: string; sub: string; services: number; popular?: boolean; icon: string }

export const TEMPLATES: Template[] = [
  { id: "t-medusa", name: "Medusa Commerce", sub: "Headless commerce · Medusa + Postgres + Redis + admin", services: 4, popular: true, icon: "service" },
  { id: "t-supabase", name: "Supabase", sub: "Auth · Postgres · Realtime · Storage · Studio", services: 6, popular: true, icon: "db" },
  { id: "t-strapi", name: "Strapi CMS", sub: "Headless CMS + Postgres", services: 2, icon: "doc" },
  { id: "t-ghost", name: "Ghost", sub: "Publishing platform · Ghost + MySQL", services: 2, icon: "doc" },
  { id: "t-nocodb", name: "NocoDB", sub: "Airtable alternative · NocoDB + Postgres", services: 2, icon: "db" },
  { id: "t-plausible", name: "Plausible Analytics", sub: "Plausible + ClickHouse + Postgres", services: 3, icon: "metrics" },
  { id: "t-umami", name: "Umami", sub: "Privacy-focused analytics + Postgres", services: 2, icon: "metrics" },
  { id: "t-n8n", name: "n8n", sub: "Workflow automation", services: 1, icon: "bolt" },
  { id: "t-grafana", name: "Grafana + Prometheus", sub: "Observability stack", services: 3, icon: "metrics" },
  { id: "t-langfuse", name: "Langfuse", sub: "LLM observability + Postgres + ClickHouse", services: 3, icon: "metrics" },
];

export interface ResourcePreset { id: string; name: string; cpu: number | null; mem: number | null; sub: string; cost: number | null; popular?: boolean }

export const RESOURCE_PRESETS: ResourcePreset[] = [
  { id: "micro", name: "Micro", cpu: 0.25, mem: 256, sub: "dev / preview / cron", cost: 4 },
  { id: "small", name: "Small", cpu: 0.5, mem: 512, sub: "small workers · static · staging api", cost: 9, popular: true },
  { id: "medium", name: "Medium", cpu: 1, mem: 1024, sub: "most production web apps", cost: 18 },
  { id: "large", name: "Large", cpu: 2, mem: 2048, sub: "high-traffic api · workers under load", cost: 36 },
  { id: "xl", name: "XL", cpu: 4, mem: 4096, sub: "database primary · heavy compute", cost: 72 },
  { id: "custom", name: "Custom", cpu: null, mem: null, sub: "tune CPU and RAM independently", cost: null },
];

export interface Region { id: string; name: string; flag: string; latency: string; nodes: number }

export const REGIONS: Region[] = [
  { id: "sfo", name: "San Francisco", flag: "🇺🇸", latency: "4ms", nodes: 3 },
  { id: "iad", name: "Virginia", flag: "🇺🇸", latency: "78ms", nodes: 3 },
  { id: "lhr", name: "London", flag: "🇬🇧", latency: "142ms", nodes: 2 },
  { id: "fra", name: "Frankfurt", flag: "🇩🇪", latency: "156ms", nodes: 2 },
  { id: "sgp", name: "Singapore", flag: "🇸🇬", latency: "198ms", nodes: 2 },
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
  /** Owner project. Undefined = general pool (any project can place tasks here). */
  project?: string;
}

export const NODES: Node[] = [
  {
    id: "n1",
    name: "helio-prod-01",
    region: "sfo",
    host: "10.0.4.11",
    cpu: { used: 6.4, total: 16 },
    mem: { used: 12, total: 32 },
    disk: { used: 84, total: 500, unit: "GB" },
    services: 8,
    status: "ready",
    role: "manager",
    availability: "active",
    joined: "62d ago",
    daemonVersion: "26.1.4",
    labels: ["primary", "ssd"],
  },
  {
    id: "n2",
    name: "helio-prod-02",
    region: "sfo",
    host: "10.0.4.12",
    cpu: { used: 5.1, total: 16 },
    mem: { used: 9, total: 32 },
    disk: { used: 71, total: 500, unit: "GB" },
    services: 7,
    status: "ready",
    role: "worker",
    availability: "active",
    joined: "62d ago",
    daemonVersion: "26.1.4",
    labels: ["ssd"],
    project: "helio",
  },
  {
    id: "n3",
    name: "helio-prod-03",
    region: "sfo",
    host: "10.0.4.13",
    cpu: { used: 7.2, total: 16 },
    mem: { used: 14, total: 32 },
    disk: { used: 112, total: 500, unit: "GB" },
    services: 9,
    status: "ready",
    role: "worker",
    availability: "active",
    joined: "47d ago",
    daemonVersion: "26.1.4",
    labels: ["gpu", "ssd"],
    project: "marketing",
  },
];

export const SWARM_JOIN_TOKEN_WORKER =
  "SWMTKN-1-49nj0mn9azfc4f9k6e2j2qg7r0s1m3a8wp1bf5xa-3v8q6oxuyc8t9g6l1zfw3krqp";
export const SWARM_JOIN_TOKEN_MANAGER =
  "SWMTKN-1-49nj0mn9azfc4f9k6e2j2qg7r0s1m3a8wp1bf5xa-12yhde9k7b3w0p1nfgxu6tlmh";
export const SWARM_MANAGER_ADDR = "10.0.4.11:2377";
