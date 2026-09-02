/**
 * Copy and data for the /next landing page (v5): a product tour built from
 * REAL screenshots of the actual control plane (apps/web, captured
 * authenticated at 2x in dark mode). No fabricated chrome — every shot is the
 * real dashboard. Counts are source-verified.
 */

import { GITHUB_URL } from "../landing/content";

export const NEXT_NAV_SECTIONS: { id: string; label: string }[] = [
  { id: "graph", label: "Graph" },
  { id: "deploys", label: "Deploys" },
  { id: "data", label: "Data" },
  { id: "templates", label: "Templates" },
];

/** Real screenshots wired into the interactive hero window. The tab labels
 *  mirror the app's own section names; each image is the full dashboard. */
export type ShotKey = "graph" | "deployments" | "data" | "templates";

export interface Shot {
  key: ShotKey;
  tab: string;
  img: string;
  alt: string;
}

export const HERO_SHOTS: Shot[] = [
  {
    key: "data",
    tab: "Data",
    img: "/landing/app-data-query.png",
    alt: "The otterdeploy Workbench: the customers table open in the data grid, 12 real rows with typed columns.",
  },
  {
    key: "graph",
    tab: "Graph",
    img: "/landing/app-graph.png",
    alt: "The otterdeploy project graph: a running Postgres database node on the canvas.",
  },
  {
    key: "deployments",
    tab: "Deployments",
    img: "/landing/app-deployments.png",
    alt: "The otterdeploy deployments view: stat tiles and a build row shipping postgres:18-alpine.",
  },
  {
    key: "templates",
    tab: "Templates",
    img: "/landing/app-templates.png",
    alt: "The otterdeploy template gallery: 98 curated stacks with category filters.",
  },
];

/** The scroll tour: each real surface, paired with what it does. */
export interface TourStop {
  id: string;
  eyebrow: string;
  title: string;
  body: string;
  img: string;
  alt: string;
  href: string;
  /** Image sits left of the copy instead of right. */
  flip?: boolean;
}

export const TOUR: TourStop[] = [
  {
    id: "graph",
    eyebrow: "Project graph",
    title: "Your whole project, on one canvas",
    body: "Services, databases and compose stacks are nodes you can read: status, replicas, mounts, the deployed commit. Click one for its logs, metrics, variables and domains. It's the same React-Flow canvas the app ships.",
    img: "/landing/app-graph.png",
    alt: "The otterdeploy project graph with a running Postgres node.",
    href: "/docs/start/concepts#resource",
  },
  {
    id: "deploys",
    eyebrow: "Deployments",
    title: "Every build and deploy, tracked",
    body: "One timeline across the project: what shipped, which trigger fired, how long it took, the failure rate. Filter by resource, status or window. Roll back to any earlier image.",
    img: "/landing/app-deployments.png",
    alt: "The otterdeploy deployments table with stat tiles.",
    href: "/docs/guides/services#rolling-out",
    flip: true,
  },
  {
    id: "data",
    eyebrow: "Data workbench",
    title: "Query your databases without leaving",
    body: "Open any managed database — or an external Postgres, MySQL or Neon URL — and read your tables in a real grid: typed columns, filters, pagination, read-only by default. Or drop into the SQL playground. No psql, no second tool.",
    img: "/landing/app-data-query.png",
    alt: "The otterdeploy Workbench data grid showing the customers table with 12 rows.",
    href: "/docs/guides/databases#browsing-the-data",
  },
  {
    id: "templates",
    eyebrow: "Templates",
    title: "Deploy 98 apps in one click",
    body: "Ghost, Plausible, n8n, Metabase, Gitea, Grafana and 90 more — each a compose file the platform's own parser round-trips with zero warnings. Pick one, fill the secrets it asks for, deploy.",
    img: "/landing/app-templates.png",
    alt: "The otterdeploy template gallery with 98 stacks.",
    href: "/docs/guides/databases#templates",
    flip: true,
  },
];

/** Verifiable in the repo: databaseEngineEnum; catalog TEMPLATES; GROUPS keys. */
export const NEXT_STATS: { value: string; label: string }[] = [
  { value: "98", label: "one-click templates" },
  { value: "34", label: "CLI commands" },
  { value: "5", label: "database engines" },
  { value: "1", label: "machine to start" },
];

export const CATALOG_URL = `${GITHUB_URL}/tree/main/apps/web/src/features/templates/catalog`;

// ── Animated deploy pipeline ─────────────────────────────────────────────────

/**
 * The stations one git-sourced deploy passes through, in the platform's own
 * words: `pending`/`building`/`running` are `deployment_status` members;
 * `image`/`rollout`/`route`/`tls` are the sub-steps the app narrates. Each
 * carries the engine that owns it and a settle time, so the animation reads
 * like a real deploy, not a spinner.
 */
export interface Phase {
  key: string;
  note: string;
  detail: string;
  ms: number;
}

export const PIPELINE_PHASES: Phase[] = [
  { key: "pending", note: "queued", detail: "webhook · push to main", ms: 700 },
  { key: "building", note: "railpack", detail: "detect · install · bun run build", ms: 2600 },
  { key: "image", note: "pushed", detail: "sha256:7d21f0 · 84 MB", ms: 900 },
  { key: "rollout", note: "swarm", detail: "1/1 replicas healthy", ms: 1500 },
  { key: "route", note: "caddy", detail: "storefront.example.com", ms: 800 },
  { key: "tls", note: "valid", detail: "ACME · Let's Encrypt", ms: 900 },
  { key: "running", note: "live", detail: "deployed in 23.1s · no downtime", ms: 1600 },
];

// ── Animated terminal ────────────────────────────────────────────────────────

export type TermLine =
  | { t: "cmd"; text: string }
  | { t: "out"; text: string; tone?: "muted" | "ok" | "info" };

/** A first deploy from the terminal — real commands, real flags, output
 *  shaped like `otterdeploy up --wait`. */
export const TERMINAL: TermLine[] = [
  { t: "cmd", text: "otterdeploy up --wait" },
  { t: "out", text: "storefront linked · otterdeploy.json written", tone: "muted" },
  { t: "out", text: "web        building → running    23.1s", tone: "ok" },
  { t: "out", text: "postgres   running", tone: "ok" },
  { t: "out", text: "https://storefront.example.com", tone: "info" },
  { t: "cmd", text: "otterdeploy logs web --since 5m" },
  { t: "out", text: "12:04:03  POST /api/orders 201 · 141ms", tone: "muted" },
  { t: "out", text: "12:04:04  GET  /checkout    200 ·  31ms", tone: "muted" },
];

// ── Integrations ─────────────────────────────────────────────────────────────

export type IntegrationLogo =
  | "github"
  | "gitlab"
  | "gitea"
  | "forgejo"
  | "bitbucket"
  | "infisical"
  | "vault"
  | "doppler"
  | "docker"
  | "harbor"
  | "tailscale"
  | "netbird"
  | "slack"
  | "discord"
  | "pagerduty";

export interface IntegrationGroup {
  title: string;
  body: string;
  items: { name: string; logo: IntegrationLogo }[];
}

export const INTEGRATIONS: IntegrationGroup[] = [
  {
    title: "Git providers",
    body: "Connect a repo and every push builds. Preview per pull request.",
    items: [
      { name: "GitHub", logo: "github" },
      { name: "GitLab", logo: "gitlab" },
      { name: "Gitea", logo: "gitea" },
      { name: "Forgejo", logo: "forgejo" },
      { name: "Bitbucket", logo: "bitbucket" },
    ],
  },
  {
    title: "Secret managers",
    body: "Sync sealed variables from the vault you already run.",
    items: [
      { name: "Infisical", logo: "infisical" },
      { name: "Vault", logo: "vault" },
      { name: "Doppler", logo: "doppler" },
    ],
  },
  {
    title: "Registries",
    body: "Pull private images, or push the ones the builder makes.",
    items: [
      { name: "Docker Hub", logo: "docker" },
      { name: "Harbor", logo: "harbor" },
    ],
  },
  {
    title: "Mesh & alerts",
    body: "A private network across your boxes; alerts where your team is.",
    items: [
      { name: "Tailscale", logo: "tailscale" },
      { name: "NetBird", logo: "netbird" },
      { name: "Slack", logo: "slack" },
      { name: "Discord", logo: "discord" },
      { name: "PagerDuty", logo: "pagerduty" },
    ],
  },
];

// ── Contrast: the manual way vs otterdeploy ──────────────────────────────────

/**
 * V7's "before / with V7" pattern, made honest and concrete. The by-hand
 * column is what a self-hoster actually does today; the otterdeploy column is
 * the one-line version. No invented numbers — the contrast is the argument.
 */
export interface Contrast {
  task: string;
  hand: string;
  od: string;
}

export const CONTRASTS: Contrast[] = [
  {
    task: "Ship a service",
    hand: "Write a Dockerfile, a compose file, a reverse-proxy config; wire TLS by hand.",
    od: "Connect the repo. Push.",
  },
  {
    task: "Add a database",
    hand: "Provision it, create a user, paste the connection string into each service.",
    od: "Reference it by name — filled in at deploy.",
  },
  {
    task: "HTTPS on a domain",
    hand: "Install certbot, hand-write nginx, add a renewal cron, hope it fires.",
    od: "Point DNS. Caddy issues and renews the cert.",
  },
  {
    task: "Preview a pull request",
    hand: "Spin a box, copy the env, remember to tear it all down.",
    od: "One per PR. Removed when it closes.",
  },
  {
    task: "Read production data",
    hand: "SSH in, run psql, squint at rows in a terminal.",
    od: "Open the Workbench. Filter the grid.",
  },
  {
    task: "Ship from CI",
    hand: "Hand-roll deploy scripts and long-lived keys.",
    od: "otterdeploy up, with a scoped token.",
  },
];
