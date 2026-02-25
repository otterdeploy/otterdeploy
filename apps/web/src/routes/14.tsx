import { createFileRoute, Link } from "@tanstack/react-router";
import { motion, useInView } from "motion/react";
import { useEffect, useRef, useState } from "react";
import {
  Github,
  ArrowRight,
  Copy,
  Check,
  Terminal,
  Shield,
  DollarSign,
  Lock,
  Truck,
  Code2,
  Settings,
  Heart,
  MessageCircle,
  Star,
  BarChart3,
  Eye,
  X,
  Zap,
  Server,
  Activity,
} from "lucide-react";

export const Route = createFileRoute("/14")({
  component: RouteComponent,
});

// ---------------------------------------------------------------------------
// Font Loader
// ---------------------------------------------------------------------------

function useFonts() {
  useEffect(() => {
    const id = "dark-paas-migrate-fonts";
    if (document.getElementById(id)) return;
    const link = document.createElement("link");
    link.id = id;
    link.rel = "stylesheet";
    link.href =
      "https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap";
    document.head.appendChild(link);
  }, []);
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VARIANT_LINKS = [
  { label: "11", to: "/11" },
  { label: "12", to: "/12" },
  { label: "13", to: "/13" },
  { label: "14", to: "/14" },
  { label: "15", to: "/15" },
  { label: "16", to: "/16" },
];

const MIGRATION_GRID_CELLS = [
  { label: "web", r: 0, c: 0 },
  { label: "api", r: 0, c: 1 },
  { label: "worker", r: 0, c: 2 },
  { label: "db", r: 1, c: 0 },
  { label: "cache", r: 1, c: 1 },
  { label: "env", r: 1, c: 2 },
  { label: "cron", r: 2, c: 0 },
  { label: "logs", r: 2, c: 1 },
  { label: "config", r: 2, c: 2 },
];

const MIGRATION_SATELLITES = [
  { label: ".HEROKU", x: -120, y: -30, arrow: true },
  { label: ".RAILWAY", x: 240, y: -40, arrow: false },
  { label: ".RENDER", x: 250, y: 90, arrow: false },
  { label: ".DOCKER", x: -130, y: 100, arrow: false },
  { label: ".K8S", x: 60, y: 210, arrow: false },
];

const STATS = [
  { value: "3min", label: "avg migration" },
  { value: "1", label: "command" },
  { value: "100%", label: "data ownership" },
  { value: "\u221e", label: "customization" },
];

const COMPARISON_FEATURES = [
  { feature: "Self-hosted", heroku: false, railway: false, render: false, otter: true },
  { feature: "Open source", heroku: false, railway: false, render: false, otter: true },
  { feature: "Declarative cfg", heroku: false, railway: "Partial", render: "Partial", otter: true },
  { feature: "Multi-env", heroku: "Limited", railway: true, render: true, otter: true },
  { feature: "RBAC", heroku: "Limited", railway: "Limited", render: "Limited", otter: true },
  { feature: "Free tier", heroku: "Limited", railway: "Limited", render: "Limited", otter: "Unlimited" },
  { feature: "Vendor lock-in", heroku: "High", railway: "Medium", render: "Medium", otter: "None" },
];

const BENTO_ITEMS = [
  {
    title: "Data Sovereignty",
    description: "Your code, your data, your infrastructure. Every byte stays on servers you control.",
    icon: Shield,
    span: 2,
  },
  {
    title: "No Surprise Bills",
    description: "Predictable costs. Your server, your budget. No per-dyno or per-seat pricing traps.",
    icon: DollarSign,
    span: 1,
  },
  {
    title: "Zero Lock-in",
    description: "Standard Docker, standard YAML. Leave anytime with zero friction.",
    icon: Lock,
    span: 1,
  },
  {
    title: "Easy Migration",
    description: "One-command import from Heroku, Railway, or Render. Configs auto-converted.",
    icon: Truck,
    span: 2,
  },
  {
    title: "Better DX",
    description: "Git push deploys, preview environments, instant rollbacks. Developer joy, not friction.",
    icon: Code2,
    span: 1,
  },
  {
    title: "Full Control",
    description: "Custom build packs, networking rules, scaling policies. It is your platform.",
    icon: Settings,
    span: 1,
  },
];

const FEATURE_TABS = {
  migrate: {
    label: "MIGRATE",
    heading: "Import from anywhere",
    bullets: [
      "Auto-detect Heroku Procfile, Railway config, or Render YAML",
      "Environment variables imported securely",
      "Database connections re-mapped automatically",
      "Rollback to source platform if anything fails",
    ],
    code: `$ otter migrate --from heroku --app my-saas
\u25b8 Connecting to Heroku API...
  \u2713 Authenticated (team: acme-corp)

\u25b8 Importing app "my-saas"...
  \u2713 Procfile detected (web, worker)
  \u2713 18 env vars imported
  \u2713 Postgres addon \u2192 otterdeploy/postgres
  \u2713 Redis addon \u2192 otterdeploy/redis

\u25b8 Building services...
  \u2713 web        Built in 12s
  \u2713 worker     Built in 8s

\u2713 Migration complete! (2m 47s)
  Dashboard: https://otter.local/apps/my-saas`,
  },
  config: {
    label: "CONFIG",
    heading: "Declarative everything",
    bullets: [
      "Single YAML file for all services",
      "Environment-specific overrides",
      "Secrets stored encrypted at rest",
      "Version-controlled infrastructure",
    ],
    code: `# otterdeploy.yml
name: my-saas
domain: app.acme.com

services:
  web:
    build: ./app
    port: 3000
    replicas: 3
    health: /api/health
  worker:
    build: ./worker
    command: node worker.js

databases:
  postgres:
    version: "16"
    backup: daily
  redis:
    version: "7"

env:
  production:
    DATABASE_POOL: 20
    LOG_LEVEL: warn`,
  },
  deploy: {
    label: "DEPLOY",
    heading: "Ship with confidence",
    bullets: [
      "Zero-downtime rolling deployments",
      "Automatic health checks and rollback",
      "Preview environments per pull request",
      "Deploy hooks for CI/CD integration",
    ],
    code: `$ otter deploy --env production

\u25b8 Building services...
  \u2713 web        Built in 8s
  \u2713 worker     Built in 5s

\u25b8 Running health checks...
  \u2713 web        GET /api/health \u2192 200
  \u2713 worker     heartbeat \u2192 ok

\u25b8 Rolling deploy (0% \u2192 100%)...
  \u2713 web [1/3]  healthy
  \u2713 web [2/3]  healthy
  \u2713 web [3/3]  healthy

\u2713 Deploy complete! (22s)
  https://app.acme.com`,
  },
  monitor: {
    label: "MONITOR",
    heading: "Observe everything",
    bullets: [
      "Built-in metrics dashboard",
      "Real-time log streaming",
      "Custom alerting rules",
      "Resource usage tracking per service",
    ],
    code: `$ otter status --app my-saas

SERVICE    STATUS   CPU   MEM    REQUESTS
web [1]    \u2713 ok     12%   128MB  1.2k/min
web [2]    \u2713 ok     15%   134MB  1.1k/min
web [3]    \u2713 ok     11%   126MB  1.3k/min
worker     \u2713 ok      8%    96MB  --
postgres   \u2713 ok     22%   512MB  840 qps
redis      \u2713 ok      3%    64MB  2.1k ops/s

ALERTS: 0 active | UPTIME: 99.98% (30d)

$ otter logs --service web --tail
[12:04:31] GET /api/users \u2192 200 (12ms)
[12:04:32] POST /api/orders \u2192 201 (45ms)`,
  },
};

type TabKey = keyof typeof FEATURE_TABS;

const TESTIMONIALS = [
  {
    name: "Sarah Kim",
    role: "CTO at Stackflow",
    text: "We migrated 14 Heroku dynos to Otterdeploy in under an hour. Our monthly bill dropped from $2,400 to $180 for a single Hetzner box.",
    initials: "SK",
  },
  {
    name: "Marcus Rivera",
    role: "Lead Engineer at Shipfast",
    text: "Railway was great until we needed RBAC and audit logs. Otterdeploy gave us both out of the box. The migration tool handled everything.",
    initials: "MR",
  },
  {
    name: "Aisha Patel",
    role: "Founder at Devtools.io",
    text: "Moved from Render in 3 minutes flat. The config auto-conversion is magic. We now have full control over our deployment pipeline.",
    initials: "AP",
  },
];

const GAIN_ITEMS = [
  "Full data sovereignty and compliance",
  "Unlimited deployments, no per-seat pricing",
  "Custom networking and security rules",
  "Open source transparency and auditability",
  "Community-driven roadmap and features",
];

const KEEP_ITEMS = [
  "Git push to deploy workflow",
  "Automatic SSL and domain management",
  "Preview environments per branch",
  "One-click database provisioning",
  "Real-time logs and metrics",
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const font = {
  display: { fontFamily: "'Plus Jakarta Sans', sans-serif" },
  body: { fontFamily: "'Plus Jakarta Sans', sans-serif" },
  mono: { fontFamily: "'JetBrains Mono', monospace" },
};

const ease = { type: "tween" as const, ease: "easeOut" as const, duration: 0.4 };

function TerminalWindow({
  title,
  children,
  className = "",
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-xl overflow-hidden border border-white/[0.08] ${className}`}
      style={{ background: "#111111" }}
    >
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-white/[0.08]">
        <div className="flex gap-1.5">
          <div className="w-3 h-3 rounded-full bg-[#3b3b3b]" />
          <div className="w-3 h-3 rounded-full bg-[#3b3b3b]" />
          <div className="w-3 h-3 rounded-full bg-[#3b3b3b]" />
        </div>
        <span
          className="text-xs ml-2 text-[#71717a]"
          style={font.mono}
        >
          {title}
        </span>
      </div>
      <div className="p-4 lg:p-5" style={font.mono}>
        {children}
      </div>
    </div>
  );
}

function ComparisonCell({ value }: { value: boolean | string }) {
  if (value === true) {
    return <span className="text-[#4ade80] font-medium">{"\u2713"}</span>;
  }
  if (value === false) {
    return <span className="text-[#71717a]">{"\u2717"}</span>;
  }
  return <span className="text-[#a1a1aa] text-xs" style={font.mono}>{value}</span>;
}

// ---------------------------------------------------------------------------
// Background
// ---------------------------------------------------------------------------

function DotGridBackground() {
  return (
    <div className="fixed inset-0 pointer-events-none z-0">
      {/* Dot grid */}
      <div
        className="absolute inset-0 opacity-[0.25]"
        style={{
          backgroundImage:
            "radial-gradient(circle, rgba(255,255,255,0.15) 1px, transparent 1px)",
          backgroundSize: "24px 24px",
        }}
      />
      {/* Aurora */}
      <div
        className="absolute inset-0"
        style={{
          background: `radial-gradient(ellipse at 25% 0%, rgba(124,58,237,0.15) 0%, transparent 50%),
                       radial-gradient(ellipse at 75% 20%, rgba(167,139,250,0.08) 0%, transparent 40%),
                       radial-gradient(ellipse at 50% 80%, rgba(34,211,238,0.05) 0%, transparent 40%)`,
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

function Nav() {
  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-[#09090b]/80 backdrop-blur-xl border-b border-white/[0.08]">
      <div className="max-w-7xl mx-auto flex items-center justify-between px-5 py-3">
        <div className="flex items-center gap-1">
          <span
            className="text-[#fafafa] text-lg font-bold tracking-tight"
            style={font.display}
          >
            otterdeploy
          </span>
          <span className="w-1.5 h-1.5 rounded-full bg-[#7c3aed] inline-block mb-2" />
        </div>

        <div className="hidden md:flex items-center gap-6">
          {["Documentation", "Migration Guide", "Compare"].map((label) => (
            <a
              key={label}
              href="#"
              className="text-sm text-[#a1a1aa] hover:text-[#fafafa] transition-colors"
              style={{ ...font.body, fontWeight: 500 }}
            >
              {label}
            </a>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <div className="hidden sm:flex items-center gap-1 mr-2">
            {VARIANT_LINKS.map((v) => (
              <Link
                key={v.to}
                to={v.to}
                className={`w-7 h-7 flex items-center justify-center text-xs rounded transition-colors ${
                  v.to === "/14"
                    ? "bg-[#7c3aed]/20 text-[#a78bfa] font-medium"
                    : "text-[#71717a] hover:text-[#a1a1aa]"
                }`}
                style={font.mono}
              >
                {v.label}
              </Link>
            ))}
          </div>
          <a
            href="#cta"
            className="px-4 py-1.5 text-sm font-semibold rounded-lg bg-[#7c3aed] text-white hover:bg-[#6d28d9] transition-colors inline-flex items-center gap-2"
            style={font.display}
          >
            <Truck size={14} /> Migrate now
          </a>
        </div>
      </div>
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Isometric Migration Diagram
// ---------------------------------------------------------------------------

function MigrationDiagram() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-40px" });

  return (
    <div ref={ref} className="flex justify-center mt-16">
      <div className="relative" style={{ width: 500, height: 400 }}>
        <div
          className="absolute left-1/2 top-1/2"
          style={{
            transform: "translate(-50%, -50%) rotateX(55deg) rotateZ(-45deg)",
            transformStyle: "preserve-3d",
          }}
        >
          <div
            className="grid grid-cols-3 gap-2"
            style={{ width: 240, height: 240 }}
          >
            {MIGRATION_GRID_CELLS.map((cell, i) => (
              <motion.div
                key={cell.label}
                className="w-[76px] h-[76px] rounded-lg border border-white/[0.08] bg-[#18181b] flex items-center justify-center hover:border-[#7c3aed]/40 transition-colors"
                style={font.mono}
                initial={{ opacity: 0, scale: 0.5 }}
                animate={inView ? { opacity: 1, scale: 1 } : {}}
                transition={{ ...ease, delay: 0.08 * i, duration: 0.5 }}
              >
                <span className="text-[10px] text-[#a1a1aa] font-medium">
                  {cell.label}
                </span>
              </motion.div>
            ))}
          </div>
        </div>

        {MIGRATION_SATELLITES.map((node, i) => (
          <motion.div
            key={node.label}
            className="absolute px-3 py-1.5 rounded-md border border-white/[0.08] bg-[#18181b] flex items-center gap-1.5"
            style={{
              left: `calc(50% + ${node.x}px)`,
              top: `calc(50% + ${node.y}px)`,
              ...font.mono,
            }}
            initial={{ opacity: 0, scale: 0.8 }}
            animate={inView ? { opacity: 1, scale: 1 } : {}}
            transition={{ ...ease, delay: 0.5 + 0.1 * i }}
          >
            <span className="text-[10px] text-[#a78bfa] font-medium">
              {node.label}
            </span>
            {node.arrow && (
              <ArrowRight size={10} className="text-[#4ade80]" />
            )}
          </motion.div>
        ))}

        <svg
          className="absolute inset-0 w-full h-full pointer-events-none"
          style={{ zIndex: -1 }}
        >
          {MIGRATION_SATELLITES.map((node, i) => (
            <motion.line
              key={i}
              x1="50%"
              y1="50%"
              x2={`calc(50% + ${node.x + 30}px)`}
              y2={`calc(50% + ${node.y + 10}px)`}
              stroke="rgba(124,58,237,0.2)"
              strokeWidth="1"
              strokeDasharray="4 4"
              initial={{ opacity: 0 }}
              animate={inView ? { opacity: 0.6 } : {}}
              transition={{ ...ease, delay: 0.6 + 0.1 * i }}
            />
          ))}
        </svg>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Hero
// ---------------------------------------------------------------------------

function Hero() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true });
  const [copied, setCopied] = useState(false);

  const installCmd = "otter migrate --from heroku --app your-app";

  const handleCopy = () => {
    navigator.clipboard.writeText(installCmd);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <section ref={ref} className="relative pt-28 pb-16 px-5">
      <div className="relative z-10 max-w-5xl mx-auto text-center">
        <motion.div
          className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-white/[0.08] bg-[#18181b] mb-8"
          initial={{ opacity: 0, y: 10 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ ...ease, delay: 0.05 }}
        >
          <Truck size={14} className="text-[#a78bfa]" />
          <span className="text-sm text-[#a1a1aa] font-medium" style={font.body}>
            Migrate in Minutes &middot; Zero Lock-in
          </span>
        </motion.div>

        <motion.h1
          className="text-5xl md:text-7xl font-extrabold text-[#fafafa] leading-[1.1] tracking-tight"
          style={font.display}
          initial={{ opacity: 0, y: 20 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ ...ease, delay: 0.1 }}
        >
          Switch from
          <br />
          Heroku in <span className="text-[#7c3aed]">Minutes</span>
        </motion.h1>

        <motion.p
          className="mt-6 text-lg text-[#a1a1aa] max-w-2xl mx-auto leading-relaxed"
          style={{ ...font.body, fontWeight: 400 }}
          initial={{ opacity: 0, y: 15 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ ...ease, delay: 0.25 }}
        >
          Everything you love about Heroku, Railway, and Render — self-hosted,
          open source, and under your control.
        </motion.p>

        <motion.div
          className="mt-8 max-w-lg mx-auto"
          initial={{ opacity: 0, y: 10 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ ...ease, delay: 0.35 }}
        >
          <button
            onClick={handleCopy}
            className="w-full flex items-center justify-between px-5 py-3.5 rounded-xl border border-white/[0.08] bg-[#111111] hover:border-[#7c3aed]/40 transition-colors group"
          >
            <span className="text-sm text-[#a78bfa] truncate" style={font.mono}>
              $ {installCmd}
            </span>
            {copied ? (
              <Check size={16} className="text-[#4ade80] shrink-0 ml-3" />
            ) : (
              <Copy
                size={16}
                className="text-[#71717a] group-hover:text-[#a1a1aa] transition-colors shrink-0 ml-3"
              />
            )}
          </button>
        </motion.div>

        <motion.div
          className="mt-6 flex items-center justify-center gap-3"
          initial={{ opacity: 0, y: 10 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ ...ease, delay: 0.45 }}
        >
          <a
            href="#cta"
            className="px-6 py-2.5 text-sm font-semibold rounded-lg bg-[#7c3aed] text-white hover:bg-[#6d28d9] transition-colors inline-flex items-center gap-2"
            style={font.display}
          >
            Migrate now <ArrowRight size={16} />
          </a>
          <a
            href="#compare"
            className="px-6 py-2.5 text-sm font-semibold rounded-lg border border-white/[0.08] text-[#fafafa] hover:border-white/[0.16] transition-colors"
            style={font.display}
          >
            Compare platforms
          </a>
        </motion.div>

        <MigrationDiagram />
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Stats Row
// ---------------------------------------------------------------------------

function StatsRow() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-60px" });

  return (
    <section
      ref={ref}
      className="border-t border-b border-white/[0.08]"
    >
      <div className="max-w-5xl mx-auto grid grid-cols-2 md:grid-cols-4">
        {STATS.map((stat, i) => (
          <motion.div
            key={stat.label}
            className={`py-10 px-6 text-center ${
              i < STATS.length - 1
                ? "md:border-r md:border-white/[0.08]"
                : ""
            } ${
              i % 2 === 0 && i < 2
                ? "border-r border-white/[0.08] md:border-r"
                : ""
            }`}
            initial={{ opacity: 0, y: 15 }}
            animate={inView ? { opacity: 1, y: 0 } : {}}
            transition={{ ...ease, delay: 0.08 * i }}
          >
            <div
              className="text-4xl md:text-5xl font-bold text-[#7c3aed] mb-1"
              style={font.display}
            >
              {stat.value}
            </div>
            <div
              className="text-sm text-[#a1a1aa]"
              style={{ ...font.body, fontWeight: 500 }}
            >
              {stat.label}
            </div>
          </motion.div>
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Comparison Table
// ---------------------------------------------------------------------------

function ComparisonTable() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });

  return (
    <section
      id="compare"
      ref={ref}
      className="py-24 px-5"
    >
      <div className="relative z-10 max-w-4xl mx-auto">
        <motion.div
          className="text-center mb-12"
          initial={{ opacity: 0, y: 15 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={ease}
        >
          <h2
            className="text-3xl md:text-4xl font-bold text-[#fafafa] tracking-tight"
            style={font.display}
          >
            How we compare
          </h2>
          <p
            className="mt-3 text-base text-[#a1a1aa]"
            style={font.body}
          >
            Feature-by-feature breakdown against popular platforms.
          </p>
        </motion.div>

        <motion.div
          className="rounded-xl border border-white/[0.08] bg-zinc-900/50 overflow-hidden"
          initial={{ opacity: 0, y: 20 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ ...ease, delay: 0.1 }}
        >
          <div className="overflow-x-auto">
            <table className="w-full text-sm" style={font.body}>
              <thead>
                <tr className="border-b border-white/[0.08]">
                  <th
                    className="text-left px-5 py-4 text-[#71717a] font-medium"
                    style={font.mono}
                  >
                    Feature
                  </th>
                  <th className="px-4 py-4 text-center text-[#a1a1aa] font-medium">
                    Heroku
                  </th>
                  <th className="px-4 py-4 text-center text-[#a1a1aa] font-medium">
                    Railway
                  </th>
                  <th className="px-4 py-4 text-center text-[#a1a1aa] font-medium">
                    Render
                  </th>
                  <th
                    className="px-4 py-4 text-center font-semibold text-white rounded-tr-xl"
                    style={{ background: "rgba(124,58,237,0.25)" }}
                  >
                    Otterdeploy
                  </th>
                </tr>
              </thead>
              <tbody>
                {COMPARISON_FEATURES.map((row, i) => (
                  <tr
                    key={row.feature}
                    className={
                      i < COMPARISON_FEATURES.length - 1
                        ? "border-b border-white/[0.05]"
                        : ""
                    }
                  >
                    <td
                      className="px-5 py-3.5 text-[#fafafa] font-medium"
                      style={font.mono}
                    >
                      {row.feature}
                    </td>
                    <td className="px-4 py-3.5 text-center">
                      <ComparisonCell value={row.heroku} />
                    </td>
                    <td className="px-4 py-3.5 text-center">
                      <ComparisonCell value={row.railway} />
                    </td>
                    <td className="px-4 py-3.5 text-center">
                      <ComparisonCell value={row.render} />
                    </td>
                    <td
                      className="px-4 py-3.5 text-center"
                      style={{ background: "rgba(124,58,237,0.08)" }}
                    >
                      <ComparisonCell value={row.otter} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </motion.div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Bento Grid -- Why Teams Switch
// ---------------------------------------------------------------------------

function BentoGrid() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });

  return (
    <section
      id="features"
      ref={ref}
      className="py-24 px-5"
    >
      <div className="relative z-10 max-w-5xl mx-auto">
        <motion.h2
          className="text-3xl md:text-4xl font-bold text-[#fafafa] tracking-tight mb-10"
          style={font.display}
          initial={{ opacity: 0, y: 15 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={ease}
        >
          Why teams switch
        </motion.h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {BENTO_ITEMS.map((item, i) => {
            const Icon = item.icon;
            return (
              <motion.div
                key={item.title}
                className={`${
                  item.span === 2 ? "md:col-span-2" : ""
                } rounded-xl border border-white/[0.08] bg-[#18181b]/80 p-6 hover:border-[#7c3aed]/30 transition-colors`}
                initial={{ opacity: 0, scale: 0.97 }}
                animate={inView ? { opacity: 1, scale: 1 } : {}}
                transition={{ ...ease, delay: 0.05 * i }}
              >
                <div className="flex items-center gap-2 mb-3">
                  <Icon size={18} className="text-[#7c3aed]" />
                  <h3
                    className="text-base font-semibold text-[#fafafa]"
                    style={font.display}
                  >
                    {item.title}
                  </h3>
                </div>
                <p
                  className="text-sm text-[#a1a1aa] leading-relaxed"
                  style={font.body}
                >
                  {item.description}
                </p>
              </motion.div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Feature Tabs (Dark Aurora)
// ---------------------------------------------------------------------------

function FeatureTabs() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });
  const [activeTab, setActiveTab] = useState<TabKey>("migrate");

  const tabIcons: Record<TabKey, React.ReactNode> = {
    migrate: <Truck size={16} />,
    config: <Settings size={16} />,
    deploy: <ArrowRight size={16} />,
    monitor: <Activity size={16} />,
  };

  const data = FEATURE_TABS[activeTab];

  return (
    <section
      ref={ref}
      className="py-24 px-5"
      style={{
        background: `radial-gradient(ellipse at 50% 0%, rgba(124,58,237,0.18) 0%, transparent 60%),
                     radial-gradient(ellipse at 80% 60%, rgba(167,139,250,0.08) 0%, transparent 50%),
                     transparent`,
      }}
    >
      <div className="relative z-10 max-w-6xl mx-auto">
        <motion.h2
          className="text-3xl md:text-4xl font-bold text-[#fafafa] text-center tracking-tight mb-10"
          style={font.display}
          initial={{ opacity: 0, y: 15 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={ease}
        >
          From migration to monitoring
        </motion.h2>

        <motion.div
          className="flex items-center justify-center gap-1 mb-10"
          initial={{ opacity: 0 }}
          animate={inView ? { opacity: 1 } : {}}
          transition={{ ...ease, delay: 0.15 }}
        >
          {(Object.keys(FEATURE_TABS) as TabKey[]).map((key) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={`flex items-center gap-2 px-4 py-2 text-sm rounded-lg transition-colors ${
                activeTab === key
                  ? "bg-[#7c3aed]/15 text-[#a78bfa]"
                  : "text-[#71717a] hover:text-[#fafafa]"
              }`}
              style={{ ...font.body, fontWeight: 500 }}
            >
              {tabIcons[key]}
              {key}
            </button>
          ))}
        </motion.div>

        <motion.div
          key={activeTab}
          className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...ease, duration: 0.3 }}
        >
          <div className="py-2">
            <span
              className="text-xs text-[#7c3aed] uppercase tracking-wider mb-3 block"
              style={font.mono}
            >
              {data.label}
            </span>
            <h3
              className="text-2xl font-bold text-[#fafafa] mb-5"
              style={font.display}
            >
              {data.heading}
            </h3>
            <ul className="flex flex-col gap-3">
              {data.bullets.map((b) => (
                <li key={b} className="flex items-center gap-3">
                  <span className="text-[#4ade80]">
                    <Check size={16} />
                  </span>
                  <span
                    className="text-sm text-[#a1a1aa]"
                    style={{ ...font.body, fontWeight: 400 }}
                  >
                    {b}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <TerminalWindow title={`${activeTab}.sh`}>
            <div className="text-xs leading-relaxed whitespace-pre">
              {data.code.split("\n").map((line, i) => {
                if (line.startsWith("#")) {
                  return (
                    <div key={i} className="text-[#71717a]">
                      {line}
                    </div>
                  );
                }
                if (line.startsWith("$")) {
                  return (
                    <div key={i} className="text-[#fafafa]">
                      {line}
                    </div>
                  );
                }
                if (line.startsWith("\u25b8")) {
                  return (
                    <div key={i} className="text-[#a1a1aa]">
                      {line}
                    </div>
                  );
                }
                if (line.includes("\u2713")) {
                  return (
                    <div key={i}>
                      <span className="text-[#4ade80]">
                        {line.slice(0, line.indexOf("\u2713") + 1)}
                      </span>
                      <span className="text-[#fafafa]">
                        {line.slice(line.indexOf("\u2713") + 1).split("\u2192")[0]}
                      </span>
                      {line.includes("\u2192") && (
                        <>
                          <span className="text-[#71717a]">{"\u2192 "}</span>
                          <span className="text-[#a78bfa]">
                            {line.split("\u2192")[1]?.trim()}
                          </span>
                        </>
                      )}
                    </div>
                  );
                }
                if (line.includes(":")) {
                  const colonIdx = line.indexOf(":");
                  return (
                    <div key={i}>
                      <span className="text-[#a78bfa]">
                        {line.slice(0, colonIdx + 1)}
                      </span>
                      <span className="text-[#fafafa]">
                        {line.slice(colonIdx + 1)}
                      </span>
                    </div>
                  );
                }
                return (
                  <div key={i} className="text-[#fafafa]">
                    {line || "\u00a0"}
                  </div>
                );
              })}
            </div>
          </TerminalWindow>
        </motion.div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Testimonials (Migration Success Stories)
// ---------------------------------------------------------------------------

function Testimonials() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });

  return (
    <section ref={ref} className="py-24 px-5">
      <div className="relative z-10 max-w-5xl mx-auto">
        <motion.div
          className="text-center mb-12"
          initial={{ opacity: 0, y: 15 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={ease}
        >
          <h2
            className="text-3xl md:text-4xl font-bold text-[#fafafa] tracking-tight"
            style={font.display}
          >
            Migration success stories
          </h2>
          <p
            className="mt-3 text-base text-[#a1a1aa]"
            style={font.body}
          >
            Teams that made the switch and never looked back.
          </p>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {TESTIMONIALS.map((t, i) => (
            <motion.div
              key={t.name}
              className="rounded-xl border border-white/[0.08] bg-[#18181b]/80 p-6"
              initial={{ opacity: 0, y: 15 }}
              animate={inView ? { opacity: 1, y: 0 } : {}}
              transition={{ ...ease, delay: 0.08 * i }}
            >
              <p
                className="text-sm text-[#a1a1aa] leading-relaxed mb-5"
                style={font.body}
              >
                "{t.text}"
              </p>
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-[#7c3aed]/15 border border-white/[0.08] flex items-center justify-center">
                  <span
                    className="text-[10px] font-medium text-[#a78bfa]"
                    style={font.mono}
                  >
                    {t.initials}
                  </span>
                </div>
                <div>
                  <div
                    className="text-sm font-semibold text-[#fafafa]"
                    style={font.display}
                  >
                    {t.name}
                  </div>
                  <div
                    className="text-xs text-[#71717a]"
                    style={font.body}
                  >
                    {t.role}
                  </div>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Two Columns: "What you gain" + "What you keep"
// ---------------------------------------------------------------------------

function TwoColumns() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });

  return (
    <section ref={ref} className="py-24 px-5 border-t border-white/[0.08]">
      <div className="relative z-10 max-w-5xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-16">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ ...ease, delay: 0.05 }}
        >
          <div className="flex items-center gap-2 mb-6">
            <Zap size={20} className="text-[#4ade80]" />
            <h3
              className="text-2xl font-bold text-[#fafafa]"
              style={font.display}
            >
              What you gain
            </h3>
          </div>
          <ul className="flex flex-col gap-3">
            {GAIN_ITEMS.map((item) => (
              <li key={item} className="flex items-start gap-3">
                <span className="mt-1 text-[#4ade80]">
                  <Check size={14} />
                </span>
                <span
                  className="text-sm text-[#a1a1aa] leading-relaxed"
                  style={font.body}
                >
                  {item}
                </span>
              </li>
            ))}
          </ul>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ ...ease, delay: 0.15 }}
        >
          <div className="flex items-center gap-2 mb-6">
            <Shield size={20} className="text-[#22d3ee]" />
            <h3
              className="text-2xl font-bold text-[#fafafa]"
              style={font.display}
            >
              What you keep
            </h3>
          </div>
          <ul className="flex flex-col gap-3">
            {KEEP_ITEMS.map((item) => (
              <li key={item} className="flex items-start gap-3">
                <span className="mt-1 text-[#22d3ee]">
                  <Check size={14} />
                </span>
                <span
                  className="text-sm text-[#a1a1aa] leading-relaxed"
                  style={font.body}
                >
                  {item}
                </span>
              </li>
            ))}
          </ul>
        </motion.div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Pricing Grid
// ---------------------------------------------------------------------------

function PricingGrid() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });

  return (
    <section ref={ref} className="py-24 px-5 border-t border-white/[0.08]">
      <div className="relative z-10 max-w-5xl mx-auto">
        <motion.div
          className="text-center mb-12"
          initial={{ opacity: 0, y: 15 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={ease}
        >
          <h2
            className="text-3xl md:text-4xl font-bold text-[#fafafa] tracking-tight"
            style={font.display}
          >
            Free to start, free to scale
          </h2>
          <p
            className="mt-3 text-base text-[#a1a1aa]"
            style={font.body}
          >
            No per-dyno pricing. No surprise invoices. Your infrastructure, your costs.
          </p>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {/* Free */}
          <motion.div
            className="rounded-xl border-2 border-[#7c3aed] bg-[#18181b]/80 p-8"
            initial={{ opacity: 0, y: 15 }}
            animate={inView ? { opacity: 1, y: 0 } : {}}
            transition={{ ...ease, delay: 0.05 }}
          >
            <span
              className="text-xs text-[#7c3aed] uppercase tracking-wider font-medium"
              style={font.mono}
            >
              Free
            </span>
            <div className="flex items-baseline gap-1 mt-2">
              <span
                className="text-4xl font-bold text-[#fafafa]"
                style={font.display}
              >
                $0
              </span>
              <span className="text-sm text-[#71717a]">/forever</span>
            </div>
            <p
              className="text-sm text-[#a1a1aa] mt-3 leading-relaxed"
              style={font.body}
            >
              Full platform, unlimited deployments, unlimited services.
              Self-hosted on your own hardware.
            </p>
            <div className="mt-5 flex flex-col gap-2.5">
              {[
                "Unlimited deploys",
                "All service types",
                "Full CLI + dashboard",
                "Community support",
                "MIT licensed",
              ].map((f) => (
                <div key={f} className="flex items-center gap-2">
                  <Check size={14} className="text-[#4ade80]" />
                  <span
                    className="text-xs text-[#a1a1aa]"
                    style={font.body}
                  >
                    {f}
                  </span>
                </div>
              ))}
            </div>
            <a
              href="#cta"
              className="mt-6 w-full block text-center px-5 py-2.5 rounded-lg bg-[#7c3aed] text-white text-sm font-semibold hover:bg-[#6d28d9] transition-colors"
              style={font.display}
            >
              Get started free
            </a>
          </motion.div>

          {/* Pro */}
          <motion.div
            className="rounded-xl border border-white/[0.08] bg-[#18181b]/80 p-8 hover:border-[#7c3aed]/30 transition-colors"
            initial={{ opacity: 0, y: 15 }}
            animate={inView ? { opacity: 1, y: 0 } : {}}
            transition={{ ...ease, delay: 0.1 }}
          >
            <span
              className="text-xs text-[#71717a] uppercase tracking-wider"
              style={font.mono}
            >
              Pro
            </span>
            <div className="flex items-baseline gap-1 mt-2">
              <span
                className="text-4xl font-bold text-[#fafafa]"
                style={font.display}
              >
                $29
              </span>
              <span className="text-sm text-[#71717a]">/mo</span>
            </div>
            <p
              className="text-sm text-[#a1a1aa] mt-3 leading-relaxed"
              style={font.body}
            >
              Priority support, advanced monitoring, and team management
              features.
            </p>
            <div className="mt-5 flex flex-col gap-2.5">
              {[
                "Everything in Free",
                "Priority support",
                "Advanced RBAC",
                "Audit logging",
                "Custom domains (unlimited)",
              ].map((f) => (
                <div key={f} className="flex items-center gap-2">
                  <Check size={14} className="text-[#7c3aed]" />
                  <span
                    className="text-xs text-[#a1a1aa]"
                    style={font.body}
                  >
                    {f}
                  </span>
                </div>
              ))}
            </div>
            <a
              href="#"
              className="mt-6 w-full block text-center px-5 py-2.5 rounded-lg border border-white/[0.08] text-[#fafafa] text-sm font-semibold hover:border-white/[0.16] transition-colors"
              style={font.display}
            >
              Start trial
            </a>
          </motion.div>

          {/* Enterprise */}
          <motion.div
            className="rounded-xl border border-white/[0.08] bg-[#18181b]/80 p-8 hover:border-[#7c3aed]/30 transition-colors"
            initial={{ opacity: 0, y: 15 }}
            animate={inView ? { opacity: 1, y: 0 } : {}}
            transition={{ ...ease, delay: 0.15 }}
          >
            <span
              className="text-xs text-[#71717a] uppercase tracking-wider"
              style={font.mono}
            >
              Enterprise
            </span>
            <div
              className="text-4xl font-bold text-[#fafafa] mt-2"
              style={font.display}
            >
              Custom
            </div>
            <p
              className="text-sm text-[#a1a1aa] mt-3 leading-relaxed"
              style={font.body}
            >
              SLA guarantees, dedicated support, custom integrations, and
              migration assistance.
            </p>
            <div className="mt-5 flex flex-col gap-2.5">
              {[
                "Everything in Pro",
                "SLA guarantee",
                "Dedicated engineer",
                "Migration assistance",
                "Custom integrations",
              ].map((f) => (
                <div key={f} className="flex items-center gap-2">
                  <Check size={14} className="text-[#7c3aed]" />
                  <span
                    className="text-xs text-[#a1a1aa]"
                    style={font.body}
                  >
                    {f}
                  </span>
                </div>
              ))}
            </div>
            <a
              href="#"
              className="mt-6 w-full block text-center px-5 py-2.5 rounded-lg border border-white/[0.08] text-[#fafafa] text-sm font-semibold hover:border-white/[0.16] transition-colors"
              style={font.display}
            >
              Contact sales
            </a>
          </motion.div>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// CTA
// ---------------------------------------------------------------------------

function CTA() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-60px" });
  const [copied, setCopied] = useState(false);

  const migrateCmd = "otter migrate --from heroku --app your-app";

  const handleCopy = () => {
    navigator.clipboard.writeText(migrateCmd);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <section
      id="cta"
      ref={ref}
      className="py-28 px-5"
      style={{
        background: `radial-gradient(ellipse at 50% 20%, rgba(124,58,237,0.25) 0%, transparent 60%),
                     radial-gradient(ellipse at 30% 80%, rgba(167,139,250,0.1) 0%, transparent 50%),
                     transparent`,
      }}
    >
      <div className="relative z-10 max-w-2xl mx-auto text-center">
        <motion.h2
          className="text-4xl md:text-5xl font-bold text-[#fafafa] tracking-tight"
          style={font.display}
          initial={{ opacity: 0, y: 20 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={ease}
        >
          Ready to break free?
        </motion.h2>

        <motion.p
          className="mt-4 text-lg text-[#a1a1aa]"
          style={font.body}
          initial={{ opacity: 0, y: 10 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ ...ease, delay: 0.1 }}
        >
          Migrate from Heroku, Railway, or Render in minutes. Keep everything
          you love, lose everything you don't.
        </motion.p>

        <motion.div
          className="mt-8"
          initial={{ opacity: 0, y: 15 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ ...ease, delay: 0.15 }}
        >
          <button
            onClick={handleCopy}
            className="w-full max-w-lg mx-auto flex items-center justify-between px-5 py-3.5 rounded-xl border border-white/[0.08] bg-[#111111] hover:border-[#7c3aed]/40 transition-colors group"
          >
            <span
              className="text-sm text-[#a78bfa] truncate"
              style={font.mono}
            >
              $ {migrateCmd}
            </span>
            {copied ? (
              <Check size={16} className="text-[#4ade80] shrink-0 ml-3" />
            ) : (
              <Copy
                size={16}
                className="text-[#71717a] group-hover:text-[#a1a1aa] transition-colors shrink-0 ml-3"
              />
            )}
          </button>
        </motion.div>

        <motion.div
          className="mt-8 flex flex-col items-center gap-4"
          initial={{ opacity: 0 }}
          animate={inView ? { opacity: 1 } : {}}
          transition={{ ...ease, delay: 0.3 }}
        >
          <div className="flex items-center gap-3">
            <a
              href="#"
              className="px-6 py-2.5 rounded-lg bg-[#7c3aed] text-white text-sm font-semibold hover:bg-[#6d28d9] transition-colors inline-flex items-center gap-2"
              style={font.display}
            >
              <Truck size={16} /> Start migration
            </a>
            <a
              href="#"
              className="px-6 py-2.5 rounded-lg border border-white/[0.08] text-[#fafafa] text-sm font-semibold hover:border-white/[0.16] transition-colors inline-flex items-center gap-2"
              style={font.display}
            >
              <Github size={16} /> View on GitHub
            </a>
          </div>

          <span className="text-xs text-[#71717a]" style={font.mono}>
            Free &middot; Open Source &middot; MIT Licensed
          </span>
        </motion.div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Footer
// ---------------------------------------------------------------------------

function Footer() {
  const columns = [
    {
      title: "Product",
      links: ["Documentation", "Migration Guide", "CLI Reference", "Changelog"],
    },
    {
      title: "Compare",
      links: ["vs Heroku", "vs Railway", "vs Render", "vs Coolify"],
    },
    {
      title: "Community",
      links: ["GitHub", "Discord", "Blog", "Contributing"],
    },
  ];

  return (
    <footer className="px-5 py-12 border-t border-white/[0.08]">
      <div className="relative z-10 max-w-7xl mx-auto">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-8">
          {/* Brand */}
          <div>
            <div className="flex items-center gap-1 mb-3">
              <span
                className="text-[#fafafa] font-bold tracking-tight"
                style={font.display}
              >
                otterdeploy
              </span>
              <span className="w-1.5 h-1.5 rounded-full bg-[#7c3aed] inline-block mb-2" />
            </div>
            <p
              className="text-sm text-[#71717a] leading-relaxed"
              style={font.body}
            >
              Open source PaaS for teams that ship.
            </p>
            <div className="flex items-center gap-3 mt-4">
              <a
                href="#"
                className="text-[#71717a] hover:text-[#a1a1aa] transition-colors"
              >
                <Github size={16} />
              </a>
              <a
                href="#"
                className="text-[#71717a] hover:text-[#a1a1aa] transition-colors"
              >
                <MessageCircle size={16} />
              </a>
            </div>
            <div className="flex items-center gap-1 mt-4">
              {VARIANT_LINKS.map((v) => (
                <Link
                  key={v.to}
                  to={v.to}
                  className={`w-6 h-6 flex items-center justify-center text-xs rounded transition-colors ${
                    v.to === "/14"
                      ? "bg-[#7c3aed]/20 text-[#a78bfa]"
                      : "text-[#71717a] hover:text-[#a1a1aa]"
                  }`}
                  style={font.mono}
                >
                  {v.label}
                </Link>
              ))}
            </div>
          </div>

          {/* Link columns */}
          {columns.map((col) => (
            <div key={col.title}>
              <h5
                className="text-xs text-[#71717a] uppercase tracking-wider mb-3"
                style={font.mono}
              >
                {col.title}
              </h5>
              <div className="flex flex-col gap-2">
                {col.links.map((link) => (
                  <a
                    key={link}
                    href="#"
                    className="text-sm text-[#a1a1aa] hover:text-[#fafafa] transition-colors"
                    style={{ ...font.body, fontWeight: 400 }}
                  >
                    {link}
                  </a>
                ))}
              </div>
            </div>
          ))}

          {/* Migration CTA */}
          <div>
            <h5
              className="text-xs text-[#71717a] uppercase tracking-wider mb-3"
              style={font.mono}
            >
              Migrate
            </h5>
            <p
              className="text-sm text-[#a1a1aa] leading-relaxed mb-3"
              style={font.body}
            >
              Switch from any PaaS in minutes.
            </p>
            <a
              href="#cta"
              className="text-xs text-[#7c3aed] hover:text-[#a78bfa] transition-colors inline-flex items-center gap-1"
              style={font.body}
            >
              Start migration <ArrowRight size={10} />
            </a>
          </div>
        </div>

        {/* Bottom */}
        <div className="mt-10 pt-6 border-t border-white/[0.08] flex flex-wrap items-center justify-between gap-4">
          <span className="text-xs text-[#71717a]" style={font.mono}>
            &copy; 2026 otterdeploy &middot; MIT License
          </span>
          <span
            className="text-xs text-[#71717a] inline-flex items-center gap-1"
            style={font.mono}
          >
            built with{" "}
            <Heart size={10} className="text-[#7c3aed]" /> by the community
          </span>
        </div>
      </div>
    </footer>
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function RouteComponent() {
  useFonts();

  return (
    <div
      className="min-h-screen text-[#fafafa]"
      style={{ ...font.body, background: "#09090b" }}
    >
      <DotGridBackground />
      <Nav />
      <Hero />
      <StatsRow />
      <ComparisonTable />
      <BentoGrid />
      <FeatureTabs />
      <Testimonials />
      <TwoColumns />
      <PricingGrid />
      <CTA />
      <Footer />
    </div>
  );
}
