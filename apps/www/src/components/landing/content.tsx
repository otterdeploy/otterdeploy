import {
  Activity,
  Database,
  GitBranch,
  Globe,
  ShieldCheck,
  Terminal,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

// ───────────────────────────────────────────────────────────────────────────
// Brand / copy constants
// ───────────────────────────────────────────────────────────────────────────

export const INSTALL_CMD = "curl -fsSL https://get.otterstack.sh | sh";
export const GITHUB_URL = "https://github.com/otterstack/otterstack";

export const NAV_LINKS = [
  { label: "Features", href: "#features" },
  { label: "Self-host", href: "#self-host" },
  { label: "Docs", href: "/docs" },
];

// ───────────────────────────────────────────────────────────────────────────
// Terminal model
// ───────────────────────────────────────────────────────────────────────────

export type TerminalLineType =
  | "command"
  | "blank"
  | "header"
  | "success"
  | "final"
  | "log"
  | "metric"
  | "comment";

export type TerminalLine = { text: string; type: TerminalLineType };

// Hero deploy walkthrough (typed out on view).
export const DEPLOY_LINES: TerminalLine[] = [
  { text: "$ otterstack deploy", type: "command" },
  { text: "", type: "blank" },
  { text: "→ Detecting framework…", type: "header" },
  { text: "  ✓ Railpack: Bun + Vite (static SPA)", type: "success" },
  { text: "  ✓ Dependencies installed (6s)", type: "success" },
  { text: "  ✓ Build complete (11s)", type: "success" },
  { text: "", type: "blank" },
  { text: "→ Publishing…", type: "header" },
  { text: "  ✓ Image pushed to registry", type: "success" },
  { text: "  ✓ Caddy route → https://app.otterstack.com", type: "success" },
  { text: "  ✓ TLS certificate issued (auto)", type: "success" },
  { text: "", type: "blank" },
  { text: "✓ Live in 19s · https://app.otterstack.com", type: "final" },
];

// ───────────────────────────────────────────────────────────────────────────
// Feature sections — grounded in what actually ships (see PRODUCT.md)
// ───────────────────────────────────────────────────────────────────────────

export type FeatureTab = {
  key: string;
  label: string;
  icon: LucideIcon;
  heading: string;
  desc: string;
  bullets: string[];
  terminal: { title: string; lines: TerminalLine[] };
};

export const FEATURE_TABS: FeatureTab[] = [
  {
    key: "deploy",
    label: "deploy",
    icon: GitBranch,
    heading: "Git-sourced builds",
    desc: "Push to deploy. Railpack detects your framework and builds it — no Dockerfile required.",
    bullets: [
      "Auto-detects Node, Bun, static SPAs, and more",
      "Builds from a subdirectory in a monorepo",
      "Live build logs streamed to the dashboard",
      "Roll back to any previous deploy",
    ],
    terminal: {
      title: "deploy.sh",
      lines: [
        { text: "$ git push origin main", type: "command" },
        { text: "", type: "blank" },
        { text: "▸ Build #128 triggered", type: "metric" },
        { text: "→ Building web…", type: "header" },
        { text: "  ✓ Railpack detected: Bun", type: "success" },
        { text: "  ✓ Built in 12s", type: "success" },
        { text: "→ Rolling deploy (zero downtime)…", type: "header" },
        { text: "  ✓ web → app.otterstack.com", type: "success" },
        { text: "", type: "blank" },
        { text: "✓ Production live · build #128 (18s)", type: "final" },
      ],
    },
  },
  {
    key: "edge",
    label: "edge",
    icon: Globe,
    heading: "Caddy edge & domains",
    desc: "Automatic HTTPS, multi-domain routing, and Vercel-style deployment protection baked into the proxy layer.",
    bullets: [
      "Add a domain and go — DNS reachability check, no TXT gate",
      "Automatic TLS, multi-domain per service",
      "Per-route access controls and custom Caddy config",
      "Deployment protection: auth wall, share links, guest OTP",
    ],
    terminal: {
      title: "domains.sh",
      lines: [
        {
          text: "$ otterstack domains add app.acme.com --service web",
          type: "command",
        },
        { text: "", type: "blank" },
        { text: "→ Configuring domain…", type: "header" },
        { text: "  ✓ DNS reachable for app.acme.com", type: "success" },
        { text: "  ✓ Caddy route configured", type: "success" },
        { text: "  ✓ TLS certificate issued", type: "success" },
        { text: "", type: "blank" },
        { text: "✓ app.acme.com → web (HTTPS active)", type: "final" },
      ],
    },
  },
  {
    key: "data",
    label: "data",
    icon: Database,
    heading: "Managed databases",
    desc: "Provision Postgres alongside your services, with scheduled backups and a built-in read-only data viewer.",
    bullets: [
      "One-click Postgres next to your services",
      "Scheduled backups with one-click restore",
      "Built-in read-only SQL data viewer",
      "Env cascade with ${{scope.KEY}} references",
    ],
    terminal: {
      title: "backup.sh",
      lines: [
        { text: "$ otterstack db backup postgres", type: "command" },
        { text: "", type: "blank" },
        { text: "→ Creating backup…", type: "header" },
        { text: "  ✓ postgres  42MB → backups/pg-2026-06-14.gz", type: "success" },
        { text: "", type: "blank" },
        { text: "✓ Backup complete", type: "final" },
        { text: "▸ Next scheduled: 2026-06-15 03:00 UTC", type: "metric" },
      ],
    },
  },
  {
    key: "observe",
    label: "observe",
    icon: Activity,
    heading: "Live logs & metrics",
    desc: "Stream build and runtime logs in real time, with per-resource metrics sampled and charted out of the box.",
    bullets: [
      "Live log streaming over oRPC event-iterators",
      "Edge access-log tail straight from the Caddy edge",
      "Per-resource CPU, memory, and network metrics",
      "Alerts via Slack, Discord, email, webhook, Telegram",
    ],
    terminal: {
      title: "logs.sh",
      lines: [
        { text: "$ otterstack logs --tail --service api", type: "command" },
        { text: "", type: "blank" },
        { text: "[12:04:01] 200 GET  /health      2ms", type: "log" },
        { text: "[12:04:03] 200 POST /api/deploy 42ms", type: "log" },
        { text: "[12:04:05] 200 GET  /api/items   4ms", type: "log" },
        { text: "", type: "blank" },
        { text: "▸ cpu 23%  mem 412MB  req/s 1.2k", type: "metric" },
        { text: "▸ uptime 99.99%  p99 48ms", type: "metric" },
      ],
    },
  },
  {
    key: "access",
    label: "access",
    icon: ShieldCheck,
    heading: "Access control & firewall",
    desc: "Org-scoped RBAC, scoped API keys, guest email OTP, and a bundled CrowdSec agent for edge firewalling.",
    bullets: [
      "Org RBAC via Better Auth",
      "Scoped API keys for automation",
      "Guest access via an email-OTP allow-list",
      "CrowdSec community blocklist bundled at the edge",
    ],
    terminal: {
      title: "access.sh",
      lines: [
        { text: "$ otterstack keys create ci --scope deploy", type: "command" },
        { text: "", type: "blank" },
        { text: "→ Creating API key…", type: "header" },
        { text: "  ✓ Scoped to: deploy", type: "success" },
        { text: "  ✓ Org: acme", type: "success" },
        { text: "", type: "blank" },
        { text: "✓ otsk_live_•••••••••••••••• created", type: "final" },
        { text: "# store it now — it won't be shown again", type: "comment" },
      ],
    },
  },
  {
    key: "cli",
    label: "cli",
    icon: Terminal,
    heading: "CLI + typed API",
    desc: "Drive everything from the otterstack CLI or the typed oRPC API — with an interactive reference in these docs.",
    bullets: [
      "A full-featured otterstack CLI",
      "End-to-end typed oRPC API (Zod + Drizzle)",
      "OpenAPI spec served at /api-reference/spec.json",
      "Interactive API reference in the docs",
    ],
    terminal: {
      title: "cli.sh",
      lines: [
        { text: "$ otterstack status", type: "command" },
        { text: "", type: "blank" },
        { text: "  web      running   app.otterstack.com", type: "log" },
        { text: "  api      running   api.otterstack.com", type: "log" },
        { text: "  postgres running   internal", type: "log" },
        { text: "  worker   running   internal", type: "log" },
        { text: "", type: "blank" },
        { text: "▸ 4 services · 1 project · org acme", type: "metric" },
      ],
    },
  },
];

// ───────────────────────────────────────────────────────────────────────────
// Why self-host / open source
// ───────────────────────────────────────────────────────────────────────────

export const SELF_HOST_BULLETS = [
  "Your servers, your data — full sovereignty",
  "No usage-based bills or per-seat pricing",
  "Run on any VPS, cloud, or bare metal",
  "Scale to your hardware, not a pricing tier",
];

export const OPEN_SOURCE_BULLETS = [
  "Open platform — no vendor lock-in",
  "The same stack, self-hosted or not",
  "Typed end to end: oRPC, Zod, Drizzle",
  "Built on Caddy, Postgres, BullMQ, Better Auth",
];

// Isometric service-graph diagram (hero visual).
export const GRID_CELLS = [
  "web",
  "api",
  "worker",
  "db",
  "cache",
  "volume",
  "secrets",
  "logs",
  "config",
];

export const SATELLITE_NODES = [
  { label: ".web", x: -116, y: -44 },
  { label: ".api", x: 232, y: -54 },
  { label: ".db", x: 252, y: 84 },
  { label: ".cache", x: -126, y: 96 },
  { label: ".worker", x: 70, y: 206 },
];

export const FOOTER_COLS = [
  {
    title: "Product",
    links: [
      { label: "Documentation", href: "/docs" },
      { label: "API reference", href: "/docs/api" },
      { label: "CLI", href: "/docs" },
    ],
  },
  {
    title: "Project",
    links: [
      { label: "GitHub", href: GITHUB_URL },
      { label: "Roadmap", href: "/docs" },
      { label: "Contributing", href: GITHUB_URL },
    ],
  },
  {
    title: "Resources",
    links: [
      { label: "Self-hosting guide", href: "/docs/getting-started" },
      { label: "Security", href: "/docs" },
    ],
  },
];
