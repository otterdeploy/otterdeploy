/**
 * Landing-page copy and data.
 *
 * Marketing surface, not documentation. The deep reference lives in /docs.
 * What stays true regardless: nothing here is invented. Counts, engine names
 * and state words are checked against the code, because a self-hoster who
 * reads a claim here and can't find it in the dashboard stops trusting the
 * dashboard too.
 */

export const GITHUB_URL = "https://github.com/otterdeploy/otterdeploy";

/** scripts/install.sh: the host installer, published at get.otterdeploy.com. */
export const INSTALL_CMD = "curl -fsSL https://get.otterdeploy.com/install.sh | bash";

// ── Nav ────────────────────────────────────────────────────────────────────

export const NAV_SECTIONS: { id: string; label: string }[] = [
  { id: "platform", label: "Platform" },
  { id: "deploy", label: "Deploy" },
  { id: "project", label: "Projects" },
  { id: "edge", label: "Edge" },
  { id: "previews", label: "Previews" },
  { id: "more", label: "Everything else" },
];

// ── Hero ───────────────────────────────────────────────────────────────────

/**
 * The stations a git-sourced deploy passes through, in order. The words are
 * the product's own: `pending` / `building` / `running` are `deployment_status`
 * members, `tls` resolves a `proxy_route_cert_state`.
 */
export const RAIL_STATIONS: { key: string; note: string }[] = [
  { key: "pending", note: "queued" },
  { key: "building", note: "railpack" },
  { key: "image", note: "pushed" },
  { key: "rollout", note: "swarm" },
  { key: "route", note: "caddy" },
  { key: "tls", note: "issued" },
];

/** Four counts, each verifiable in the repository. */
export const HERO_FACTS: { value: string; label: string }[] = [
  { value: "5", label: "database engines" },
  { value: "18", label: "stack templates" },
  { value: "34", label: "CLI commands" },
  { value: "1", label: "machine to start" },
];

// ── Everything else ────────────────────────────────────────────────────────

/**
 * The rest of the surface, as names only. Anyone who needs the detail is one
 * click from the docs; putting all fifty descriptions on the landing page is
 * what made the first draft unreadable.
 */
export const CHIP_GROUPS: { title: string; chips: string[] }[] = [
  {
    title: "Build & deploy",
    chips: [
      "Framework auto-detect",
      "Dockerfile builds",
      "Monorepo aware",
      "Compose stacks",
      "18 stack templates",
      "Rollback",
      "Crash reporting",
      "Environments",
    ],
  },
  {
    title: "Edge & networking",
    chips: [
      "Multi-domain routing",
      "Automatic TLS",
      "Custom certificates",
      "Layer-4 exposure",
      "Deployment protection",
      "Access logs",
      "Edge events",
      "CrowdSec",
    ],
  },
  {
    title: "Data",
    chips: [
      "Postgres",
      "Redis",
      "MariaDB",
      "MongoDB",
      "ClickHouse",
      "Built-in data browser",
      "Encrypted backups",
      "Scheduled snapshots",
      "Volumes & mounts",
    ],
  },
  {
    title: "Operate",
    chips: [
      "Live logs",
      "CPU & memory metrics",
      "Web terminal",
      "Multi-node Swarm",
      "Tailscale & NetBird mesh",
      "Host health alerts",
      "Slack, Discord, PagerDuty",
      "Raw Docker",
    ],
  },
  {
    title: "Access & security",
    chips: [
      "Org RBAC",
      "Scoped API keys",
      "Audit log",
      "Sealed variables",
      "Host firewall",
      "SSH keys",
      "Private registries",
      "Anomaly alerts",
    ],
  },
  {
    title: "Automate",
    chips: [
      "otterdeploy.json",
      "Typed oRPC API",
      "34 CLI commands",
      "Outbound webhooks",
      "Inbound triggers",
      "Device login",
      "CI tokens",
      "Shell completions",
    ],
  },
];

// ── Close ──────────────────────────────────────────────────────────────────

export const REQUIREMENTS: { label: string; value: string }[] = [
  { label: "Host", value: "One Linux box with root" },
  { label: "Runtime", value: "Docker, Swarm-enabled by the installer" },
  { label: "Ports", value: "80 and 443, for the edge and ACME" },
];

export const FOOTER_LINKS: { title: string; links: { label: string; href: string }[] }[] = [
  {
    title: "Docs",
    links: [
      { label: "Introduction", href: "/docs" },
      { label: "Getting started", href: "/docs/start/first-deploy" },
      { label: "CLI reference", href: "/docs/cli" },
      { label: "API reference", href: "/docs/reference/api" },
    ],
  },
  {
    title: "Project",
    links: [
      { label: "GitHub", href: GITHUB_URL },
      { label: "License: AGPL-3.0", href: `${GITHUB_URL}/blob/main/LICENSE` },
      { label: "Issues", href: `${GITHUB_URL}/issues` },
    ],
  },
];
