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

/**
 * The bar shows six stops, not every section: the centre of the bar is a map,
 * and a map that names every street stops being one. Edge and "everything
 * else" are still on the page; they're just not nav-worthy.
 */
export const NAV_SECTIONS: { id: string; label: string }[] = [
  { id: "platform", label: "Platform" },
  { id: "deploy", label: "Deploy" },
  { id: "project", label: "Projects" },
  { id: "previews", label: "Previews" },
  { id: "compare", label: "Compare" },
  { id: "faq", label: "FAQ" },
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

// ── Compare ────────────────────────────────────────────────────────────────

/**
 * The table every visitor was going to build in a second tab anyway.
 *
 * Marks are deliberately generous to the competition: `partial` means the
 * capability exists but needs wiring, plugins or caveats. Anything we are not
 * sure of is marked in the competitor's favour — being caught overclaiming
 * once costs more than every row combined.
 */
export type CompareMark = "yes" | "partial" | "no";

export const COMPARE_COLUMNS = ["otterdeploy", "Coolify", "Dokploy", "CapRover", "Kamal"];

export const COMPARE_ROWS: { label: string; marks: CompareMark[] }[] = [
  { label: "Web dashboard", marks: ["yes", "yes", "yes", "yes", "no"] },
  { label: "Preview deployments per PR", marks: ["yes", "yes", "yes", "no", "no"] },
  { label: "Database branching for previews", marks: ["yes", "no", "no", "no", "no"] },
  { label: "Managed databases", marks: ["yes", "yes", "yes", "partial", "partial"] },
  { label: "Encrypted, scheduled backups", marks: ["yes", "partial", "partial", "partial", "no"] },
  { label: "Zero-downtime rollouts", marks: ["yes", "partial", "yes", "partial", "yes"] },
  { label: "Multi-node scheduling", marks: ["yes", "partial", "yes", "yes", "partial"] },
  { label: "Compose stacks as one resource", marks: ["yes", "yes", "yes", "partial", "no"] },
  { label: "Typed API + CLI", marks: ["yes", "partial", "partial", "partial", "partial"] },
  { label: "Tailscale & NetBird mesh built in", marks: ["yes", "no", "no", "no", "no"] },
  { label: "Host firewall + CrowdSec by default", marks: ["yes", "no", "no", "no", "no"] },
];

// ── FAQ ────────────────────────────────────────────────────────────────────

/**
 * Straight answers, including the uncomfortable ones. Every answer restates
 * something already true elsewhere on this page or in the docs — the FAQ is
 * where a visitor checks whether the marketing was honest.
 */
export const FAQ_ITEMS: { q: string; a: string }[] = [
  {
    q: "Is it production-ready?",
    a: "Not yet. otterdeploy is pre-1.0 and under active development: interfaces and schemas still change without migration paths. Run it on something you'd be willing to rebuild — side projects, staging, internal tools — and hold the production workloads until 1.0.",
  },
  {
    q: "What does it cost?",
    a: "Nothing. It's AGPL-3.0 open source with no tiers, no seats, no usage bill and no hosted upsell hiding features. You pay for your own hardware, which is the point.",
  },
  {
    q: "How is this different from Coolify or Dokploy?",
    a: "Same family, different bets. We bet on previews with database branching, a typed API and CLI for automation, mesh networking built in, and host security (firewall, CrowdSec) on by default rather than as homework. If another tool fits you better, use it — the comparison table above concedes their wins on purpose.",
  },
  {
    q: "Do I need Kubernetes?",
    a: "No. The installer puts Docker into Swarm mode and that's the whole orchestrator. One binary surface to learn, and multi-node when you need it by joining another box.",
  },
  {
    q: "What do I need to start?",
    a: "One Linux box you have root on, with ports 80 and 443 reachable for the edge and ACME. The installer does the rest, including the firewall.",
  },
  {
    q: "What happens when the box dies?",
    a: "Backups are encrypted, scheduled and restorable to any snapshot, so the honest answer is: you restore onto a new box. A single machine is a single point of failure — that trade is yours to make, and multi-node Swarm is there when you outgrow it.",
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
