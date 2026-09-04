/**
 * Copy and data for the /next landing page (v5): a product tour built from
 * REAL screenshots of the actual control plane (apps/web, captured
 * authenticated at 2x in dark mode). No fabricated chrome — every shot is the
 * real dashboard. Counts are source-verified.
 */

import { GITHUB_URL } from "../landing/content";

const CATALOG_URL = `${GITHUB_URL}/tree/main/apps/web/src/features/templates/catalog`;

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
    alt: "The otterdeploy Workbench: the customers table open in the data grid, 12 sample rows with typed columns.",
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
    alt: "The otterdeploy template gallery: 90+ curated stacks with category filters.",
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
  /** Optional direct evidence behind a product claim. */
  sourceHref?: string;
  /** Image sits left of the copy instead of right. */
  flip?: boolean;
}

export const TOUR: TourStop[] = [
  {
    id: "graph",
    eyebrow: "Project graph",
    title: "Your whole project, on one canvas",
    body: "Services, databases and compose stacks become nodes with at-a-glance status and details. Open one for the controls it supports: logs, metrics, variables, routing, mounts and deployment history. It's the same React-Flow canvas the app ships.",
    img: "/landing/app-graph.png",
    alt: "The otterdeploy project graph with a running Postgres node.",
    href: "/docs/start/concepts#resource",
  },
  {
    id: "deploys",
    eyebrow: "Deployments",
    title: "Every build and deploy, tracked",
    body: "One timeline across the project: what shipped, which trigger fired, how long it took, the failure rate. Filter by resource, status or window. Roll a service back to an image from a settled successful deployment.",
    img: "/landing/app-deployments.png",
    alt: "The otterdeploy deployments table with stat tiles.",
    href: "/docs/guides/services#rolling-out",
    flip: true,
  },
  {
    id: "data",
    eyebrow: "Data workbench",
    title: "Query your databases without leaving",
    body: "Browse PostgreSQL and MariaDB in a table grid or SQL editor. Redis and MongoDB have dedicated viewers; ClickHouse is not covered by the Workbench today. External PostgreSQL, MySQL and Neon URLs can join the workbench.",
    img: "/landing/app-data-query.png",
    alt: "The otterdeploy Workbench data grid showing the customers table with 12 sample rows.",
    href: "/docs/guides/databases#browsing-the-data",
  },
  {
    id: "templates",
    eyebrow: "Templates",
    title: "Deploy from 90+ templates",
    body: "Ghost, Plausible, n8n, Metabase, Gitea, Grafana and dozens more, each a compose file the platform's own parser accepts with zero warnings. Pick one, fill the required variables, review it, then stage and deploy.",
    img: "/landing/app-templates.png",
    alt: "The otterdeploy template gallery with 90+ stacks.",
    href: "/docs/guides/templates",
    sourceHref: CATALOG_URL,
    flip: true,
  },
];

/** Verifiable in the repo: databaseEngineEnum and catalog TEMPLATES. */
export const NEXT_STATS: { value: string; label: string }[] = [
  { value: "90+", label: "curated templates" },
  { value: "Typed", label: "CLI command tree" },
  { value: "5", label: "database engines" },
  { value: "1", label: "machine to start" },
];

// ── Animated deploy pipeline ─────────────────────────────────────────────────

/**
 * The stations one git-sourced deploy passes through, in the platform's own
 * words: `pending`/`building`/`running` are `deployment_status` members;
 * `image`/`rollout`/`route`/`tls` are the sub-steps the app narrates. Each
 * carries the engine that owns it and an animation hold time, so the sequence
 * reads like a deploy without presenting those UI delays as benchmark data.
 */
export interface Phase {
  key: string;
  note: string;
  detail: string;
  animationMs: number;
}

export const PIPELINE_PHASES: Phase[] = [
  { key: "pending", note: "queued", detail: "webhook · push to main", animationMs: 700 },
  {
    key: "building",
    note: "railpack",
    detail: "detect · install · bun run build",
    animationMs: 2600,
  },
  {
    key: "image",
    note: "pushed",
    detail: "content-addressed image published",
    animationMs: 900,
  },
  {
    key: "rollout",
    note: "swarm",
    detail: "start-first update · new task running",
    animationMs: 1500,
  },
  { key: "route", note: "caddy", detail: "storefront.example.com", animationMs: 800 },
  { key: "tls", note: "valid", detail: "ACME · Let's Encrypt", animationMs: 900 },
  {
    key: "running",
    note: "live",
    detail: "route updated · rollout complete",
    animationMs: 1600,
  },
];

// ── Animated terminal ────────────────────────────────────────────────────────

export type TermLine =
  | { t: "cmd"; text: string }
  | { t: "out"; text: string; tone?: "muted" | "ok" | "info" };

/** An example first deploy using real commands and flags, with representative
 * output shaped like `otterdeploy up --wait`. It deliberately makes no timing
 * or image-size claim. */
export const TERMINAL: TermLine[] = [
  { t: "cmd", text: "otterdeploy up --wait" },
  { t: "out", text: "storefront linked · otterdeploy.json written", tone: "muted" },
  { t: "out", text: "web        building → running", tone: "ok" },
  { t: "out", text: "postgres   running", tone: "ok" },
  { t: "out", text: "https://storefront.example.com", tone: "info" },
  { t: "cmd", text: "otterdeploy logs web --since 5m" },
  { t: "out", text: "12:04:03  POST /api/orders 201", tone: "muted" },
  { t: "out", text: "12:04:04  GET  /checkout    200", tone: "muted" },
];

// ── Integrations ─────────────────────────────────────────────────────────────

export type IntegrationLogo =
  | "github"
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
    title: "Git source",
    body: "Connect GitHub for push builds and opt-in pull request previews.",
    items: [{ name: "GitHub", logo: "github" }],
  },
  {
    title: "Secret managers",
    body: "Resolve secrets from the vault you already run at deploy time.",
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
    body: "Join your boxes to a mesh during provisioning; send alerts where your team is.",
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
    od: "Reference it by name, filled in at deploy.",
  },
  {
    task: "HTTPS on a domain",
    hand: "Install certbot, hand-write nginx, add a renewal cron, hope it fires.",
    od: "Point DNS. Caddy issues and renews the cert.",
  },
  {
    task: "Preview a pull request",
    hand: "Spin a box, copy the env, remember to tear it all down.",
    od: "Enable it per service. Removed when the PR closes.",
  },
  {
    task: "Read application data",
    hand: "SSH in, run psql, squint at rows in a terminal.",
    od: "Open the Workbench. Filter the grid.",
  },
  {
    task: "Ship from CI",
    hand: "Hand-roll deploy scripts and long-lived keys.",
    od: "otterdeploy up, with a scoped token.",
  },
];
