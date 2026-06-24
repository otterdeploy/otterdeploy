export const INSTALL_CMD = "curl -fsSL https://get.otterdeploy.sh | sh";
export const GITHUB_URL = "https://github.com/otterdeploy/otterdeploy";

export type TerminalLineType =
  | "command"
  | "blank"
  | "header"
  | "success"
  | "final"
  | "log"
  | "metric"
  | "comment";

export interface TerminalLine { text: string; type: TerminalLineType }

// Hero deploy walkthrough (typed out on view).
export const DEPLOY_LINES: TerminalLine[] = [
  { text: "$ otterdeploy deploy", type: "command" },
  { text: "", type: "blank" },
  { text: "→ Detecting framework…", type: "header" },
  { text: "  ✓ Railpack: Bun + Vite (static SPA)", type: "success" },
  { text: "  ✓ Dependencies installed (6s)", type: "success" },
  { text: "  ✓ Build complete (11s)", type: "success" },
  { text: "", type: "blank" },
  { text: "→ Publishing…", type: "header" },
  { text: "  ✓ Image pushed to registry", type: "success" },
  { text: "  ✓ Caddy route → https://app.otterdeploy.com", type: "success" },
  { text: "  ✓ TLS certificate issued (auto)", type: "success" },
  { text: "", type: "blank" },
  { text: "✓ Live in 19s · https://app.otterdeploy.com", type: "final" },
];


// Top tab bar on the right "README" column. Each tab is an in-page section —
// the bar is a scroll-spy: clicking smooth-scrolls to the section and the
// underline slides to whichever section is currently in view.
export const README_TABS: { id: string; label: string }[] = [
  { id: "readme", label: "README" },
  { id: "features", label: "Features" },
  { id: "deploy", label: "Deploy" },
  { id: "start", label: "Get started" },
];

// Numbered feature cells (01–09). `detail` is a short machine-voice line shown
// in mono at the bottom of each cell — the equivalent of Better Auth's tiny
// inline widgets, but honest one-liners instead of faux UI.
export interface FeatureCell {
  n: string;
  title: string;
  desc: string;
  detail: string;
}

export const FEATURE_CELLS: FeatureCell[] = [
  {
    n: "01",
    title: "Git-sourced builds",
    desc: "Push to deploy. Railpack detects your stack — no Dockerfile required.",
    detail: "git push → build #128 · 18s",
  },
  {
    n: "02",
    title: "Caddy edge & domains",
    desc: "Automatic HTTPS, multi-domain routing, add-a-domain-and-go.",
    detail: "app.acme.com ✓ TLS",
  },
  {
    n: "03",
    title: "Managed Postgres",
    desc: "Provision databases beside your services with a read-only viewer.",
    detail: "postgres · 42MB · daily",
  },
  {
    n: "04",
    title: "Live logs & metrics",
    desc: "Real-time build and runtime streams, per-resource metrics charted.",
    detail: "cpu 23% · p99 48ms",
  },
  {
    n: "05",
    title: "Access control",
    desc: "Org RBAC, scoped API keys, and guest access via email OTP.",
    detail: "otsk_live_••••••••",
  },
  {
    n: "06",
    title: "Edge firewall",
    desc: "Bundled CrowdSec agent enforcing the community IP blocklist.",
    detail: "crowdsec · identity-blind",
  },
  {
    n: "07",
    title: "Backups & restore",
    desc: "Scheduled database dumps with one-click restore to any point.",
    detail: "next 03:00 UTC",
  },
  {
    n: "08",
    title: "Secrets & env cascade",
    desc: "Three-tier env with ${{scope.KEY}} references across resources.",
    detail: "web ← project ← org",
  },
  {
    n: "09",
    title: "CLI + typed API",
    desc: "Drive everything from the CLI or the end-to-end typed oRPC API.",
    detail: "npx otterdeploy status",
  },
];

// "Built on" strip — replaces Better Auth's "trusted by" partner logos with the
// real open stack underneath otterdeploy. Honest, not seeded.
export const BUILT_ON = [
  "Caddy",
  "Postgres",
  "Bun",
  "BullMQ",
  "Better Auth",
  "Drizzle",
  "oRPC",
  "Docker",
];

// Left-panel footer links (Better Auth has Community / Changelog / Legal / …).
export const PANEL_LINKS = [
  { label: "Docs", href: "/docs" },
  { label: "GitHub", href: GITHUB_URL, external: true },
  { label: "Changelog", href: "/docs" },
  { label: "Self-host", href: "#features" },
];

// Isometric service-graph diagram (the left brand-panel visual).
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
