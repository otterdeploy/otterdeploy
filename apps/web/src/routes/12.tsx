import { createFileRoute, Link } from "@tanstack/react-router";
import { motion, useInView } from "motion/react";
import { useEffect, useRef, useState } from "react";
import {
  Github,
  ArrowRight,
  Copy,
  Check,
  Terminal,
  GitBranch,
  FileCode2,
  KeyRound,
  Flame,
  ShieldCheck,
  ChevronRight,
  Quote,
  Zap,
  Heart,
  MessageCircle,
  Star,
} from "lucide-react";

export const Route = createFileRoute("/12")({
  component: RouteComponent,
});

// ---------------------------------------------------------------------------
// Font Loader
// ---------------------------------------------------------------------------

function useFonts() {
  useEffect(() => {
    const id = "dark-paas-dx-fonts";
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

const HERO_GRID_LABELS = [".DOCKERFILE", ".YAML", ".GIT", ".ENV", ".SSH"];

const STATS_BAR = [
  { value: "12s", label: "avg deploy" },
  { value: "1", label: "config file" },
  { value: "0", label: "dashboards" },
  { value: "100%", label: "CLI coverage" },
];

const OTTER_HELP_LINES = [
  "$ otter --help",
  "",
  "Usage: otter <command> [options]",
  "",
  "Commands:",
  "  init        Scaffold a new project",
  "  deploy      Push to production",
  "  logs        Stream real-time logs",
  "  secrets     Manage encrypted secrets",
  "  env         Environment variables",
  "  dev         Local dev with hot reload",
  "  rollback    Revert last deploy",
  "  status      Service health check",
  "",
  "Run otter <command> --help for details",
];

const YAML_SNIPPET = `name: myapp
runtime: node-20
build:
  command: npm run build
  output: dist
deploy:
  port: 3000
  health: /api/health
  replicas: 2`;

const GIT_PUSH_LINES = [
  "$ git push origin main",
  "Enumerating objects: 12, done.",
  "Total 12 (delta 4), reused 0",
  "",
  "\u2713 Build triggered",
  "\u2713 Tests passed (2.1s)",
  "\u2713 Deployed to production",
  "",
  "https://myapp.otterdeploy.sh",
];

const ENV_DIAGRAM = {
  prod: ["DATABASE_URL", "REDIS_URL", "API_KEY", "NODE_ENV=production"],
  staging: ["\u2191 inherits prod", "NODE_ENV=staging", "DEBUG=true"],
  dev: ["\u2191 inherits staging", "NODE_ENV=development", "HOT_RELOAD=true"],
};

const FEATURE_TABS_DATA = {
  init: {
    label: "INIT",
    heading: "Bootstrap in seconds",
    bullets: [
      "Interactive project scaffolding",
      "Framework detection and auto-config",
      "Generates otter.yaml from your stack",
      "Works with any language or runtime",
    ],
    code: `$ otter init

\u25b8 Detecting project...
  Framework:  Next.js 14
  Runtime:    Node 20
  Package:    bun

\u25b8 Generating config...
  \u2713 otter.yaml created
  \u2713 .env.example updated
  \u2713 Dockerfile generated

\u2713 Project initialized!
  Run "otter dev" to start locally.`,
  },
  deploy: {
    label: "DEPLOY",
    heading: "Ship with one command",
    bullets: [
      "Zero-downtime rolling deploys",
      "Automatic health checks",
      "Instant rollback on failure",
      "Deploy previews per branch",
    ],
    code: `$ otter deploy --env production

\u25b8 Building...
  \u2713 Dockerfile found
  \u2713 Image built (8.2s)
  \u2713 Pushed to registry

\u25b8 Deploying...
  \u2713 Health check passed
  \u2713 Traffic shifted (0% \u2192 100%)
  \u2713 Old containers drained

\u2713 Live at https://myapp.com (12s)`,
  },
  logs: {
    label: "LOGS",
    heading: "Real-time observability",
    bullets: [
      "Stream logs from any service",
      "Filter by severity and timestamp",
      "Tail multiple services at once",
      "Pipe to your favorite tools",
    ],
    code: `$ otter logs --service api --tail

[14:23:01] INFO  Server listening on :8080
[14:23:02] INFO  Connected to postgres
[14:23:02] INFO  Redis cache warmed
[14:23:05] INFO  GET /api/health 200 (2ms)
[14:23:06] INFO  POST /api/users 201 (18ms)
[14:23:08] WARN  Rate limit near threshold
[14:23:09] INFO  GET /api/users 200 (4ms)`,
  },
  secrets: {
    label: "SECRETS",
    heading: "Encrypted at rest",
    bullets: [
      "AES-256 encryption for all secrets",
      "Per-environment secret scoping",
      "Rotate without redeploying",
      "Audit log for every access",
    ],
    code: `$ otter secrets set API_KEY sk_live_xxx --env prod

\u25b8 Encrypting secret...
  \u2713 Encrypted with AES-256
  \u2713 Stored in vault

$ otter secrets list --env prod
NAME          UPDATED       ENV
API_KEY       2 min ago     prod
DB_PASSWORD   3 days ago    prod
SMTP_TOKEN    1 week ago    prod

\u2713 3 secrets in production`,
  },
  env: {
    label: "ENV",
    heading: "Cascading environments",
    bullets: [
      "Inherit variables across environments",
      "Override only what changes",
      "Type-safe validation on deploy",
      "Diff environments side by side",
    ],
    code: `$ otter env diff prod staging

  DATABASE_URL    \u2022 same
  REDIS_URL       \u2022 same
  API_KEY         \u2022 same
- NODE_ENV        = production
+ NODE_ENV        = staging
+ DEBUG           = true

2 differences found.`,
  },
};

type TabKey = keyof typeof FEATURE_TABS_DATA;

const TESTIMONIALS = [
  {
    quote:
      "I deleted our entire CI/CD pipeline and replaced it with otter deploy. 300 lines of YAML gone. Best Monday ever.",
    author: "Sarah K.",
    role: "Staff Engineer at Vercel",
    initials: "SK",
  },
  {
    quote:
      "The CLI is absurdly well-designed. I taught our junior devs to deploy to production in under five minutes.",
    author: "Marcus L.",
    role: "CTO at Raycast",
    initials: "ML",
  },
  {
    quote:
      "otter dev with hot reload changed how we work. It mirrors production locally. No more works-on-my-machine.",
    author: "Priya R.",
    role: "Platform Lead at Linear",
    initials: "PR",
  },
];

const DEV_STATS = [
  { value: "4.8k", label: "GitHub stars" },
  { value: "280+", label: "contributors" },
  { value: "50k+", label: "deploys / week" },
  { value: "<15s", label: "avg deploy time" },
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
      className={`rounded-xl overflow-hidden border border-[rgba(255,255,255,0.08)] ${className}`}
      style={{ background: "#111111" }}
    >
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[rgba(255,255,255,0.08)]">
        <div className="flex gap-1.5">
          <div className="w-3 h-3 rounded-full bg-[#3b3b3b]" />
          <div className="w-3 h-3 rounded-full bg-[#3b3b3b]" />
          <div className="w-3 h-3 rounded-full bg-[#3b3b3b]" />
        </div>
        <span className="text-xs ml-2 text-[#71717a]" style={font.mono}>
          {title}
        </span>
      </div>
      <div className="p-4 lg:p-5" style={font.mono}>
        {children}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

function Nav() {
  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-[#09090b]/90 backdrop-blur-xl border-b border-[rgba(255,255,255,0.08)]">
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
          {["Docs", "CLI Reference", "GitHub"].map((item) => (
            <a
              key={item}
              href="#"
              className="text-sm text-[#a1a1aa] hover:text-[#fafafa] transition-colors"
              style={{ ...font.body, fontWeight: 500 }}
            >
              {item}
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
                  v.to === "/12"
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
            <Terminal size={14} /> Quick Start
          </a>
        </div>
      </div>
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Hero
// ---------------------------------------------------------------------------

function Hero() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true });
  const [copied, setCopied] = useState(false);

  const installCmd = "npm install -g otterdeploy";

  const handleCopy = () => {
    navigator.clipboard.writeText(installCmd);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <section
      ref={ref}
      className="pt-28 pb-16 px-5"
      style={{
        background: `radial-gradient(ellipse at 50% 0%, rgba(124,58,237,0.15) 0%, transparent 50%),
                     radial-gradient(ellipse at 80% 20%, rgba(59,130,246,0.08) 0%, transparent 40%),
                     #09090b`,
      }}
    >
      <div className="max-w-5xl mx-auto text-center">
        <motion.div
          className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-[rgba(255,255,255,0.08)] bg-[#18181b] mb-8"
          initial={{ opacity: 0, y: 10 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ ...ease, delay: 0.05 }}
        >
          <Terminal size={14} className="text-[#a78bfa]" />
          <span className="text-sm text-[#a1a1aa]" style={font.mono}>
            CLI-First &middot; Open Source &middot; MIT License
          </span>
        </motion.div>

        <motion.h1
          className="text-5xl md:text-7xl font-extrabold text-[#fafafa] leading-[1.1] tracking-tight"
          style={font.display}
          initial={{ opacity: 0, y: 20 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ ...ease, delay: 0.1 }}
        >
          Deploy from Your
          <br />
          <span className="text-[#7c3aed]">Terminal</span>
        </motion.h1>

        <motion.p
          className="mt-6 text-lg text-[#a1a1aa] max-w-2xl mx-auto leading-relaxed"
          style={{ ...font.body, fontWeight: 400 }}
          initial={{ opacity: 0, y: 15 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ ...ease, delay: 0.25 }}
        >
          A CLI-first, self-hosted platform. Config as code, git-driven deploys,
          zero dashboards required.
        </motion.p>

        {/* Install Command Box */}
        <motion.div
          className="mt-8 flex justify-center"
          initial={{ opacity: 0, y: 10 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ ...ease, delay: 0.35 }}
        >
          <button
            onClick={handleCopy}
            className="flex items-center gap-3 px-5 py-3.5 rounded-xl border border-[rgba(255,255,255,0.08)] bg-[#111111] hover:border-[#7c3aed]/40 transition-colors group"
          >
            <span className="text-sm text-[#71717a]" style={font.mono}>$</span>
            <span className="text-sm text-[#a78bfa]" style={font.mono}>
              {installCmd}
            </span>
            {copied ? (
              <Check size={16} className="text-[#4ade80] shrink-0 ml-2" />
            ) : (
              <Copy
                size={16}
                className="text-[#71717a] group-hover:text-[#a1a1aa] transition-colors shrink-0 ml-2"
              />
            )}
          </button>
        </motion.div>

        {/* Buttons */}
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
            Quick Start <ArrowRight size={16} />
          </a>
          <a
            href="#"
            className="px-6 py-2.5 text-sm font-semibold rounded-lg border border-[rgba(255,255,255,0.08)] text-[#fafafa] hover:border-[#a1a1aa]/30 transition-colors inline-flex items-center gap-2"
            style={font.display}
          >
            <Github size={16} /> View Source on GitHub
          </a>
        </motion.div>

        {/* Isometric Grid with Dev Labels */}
        <motion.div
          className="mt-20 flex justify-center"
          initial={{ opacity: 0 }}
          animate={inView ? { opacity: 1 } : {}}
          transition={{ ...ease, delay: 0.55 }}
        >
          <div className="relative" style={{ width: 500, height: 320 }}>
            <div
              className="absolute left-1/2 top-1/2"
              style={{
                transform: "translate(-50%, -50%) rotateX(55deg) rotateZ(-45deg)",
                transformStyle: "preserve-3d",
              }}
            >
              <div className="grid grid-cols-3 gap-3" style={{ width: 240, height: 160 }}>
                {[0, 1, 2, 3, 4, 5].map((i) => (
                  <motion.div
                    key={i}
                    className="w-[76px] h-[76px] rounded-lg border border-[rgba(255,255,255,0.08)] bg-[#18181b] flex items-center justify-center hover:border-[#7c3aed]/40 transition-colors"
                    initial={{ opacity: 0, scale: 0.5 }}
                    animate={inView ? { opacity: 1, scale: 1 } : {}}
                    transition={{ ...ease, delay: 0.6 + 0.08 * i, duration: 0.5 }}
                  >
                    <span className="text-[10px] text-[#71717a] font-medium" style={font.mono}>
                      {["web", "api", "worker", "db", "cache", "cron"][i]}
                    </span>
                  </motion.div>
                ))}
              </div>
            </div>
            {HERO_GRID_LABELS.map((label, i) => {
              const positions = [
                { x: -110, y: -50 },
                { x: 230, y: -60 },
                { x: 250, y: 70 },
                { x: -120, y: 80 },
                { x: 60, y: 190 },
              ];
              const pos = positions[i];
              return (
                <motion.div
                  key={label}
                  className="absolute px-3 py-1.5 rounded-md border border-[rgba(255,255,255,0.08)] bg-[#18181b]"
                  style={{
                    left: `calc(50% + ${pos.x}px)`,
                    top: `calc(50% + ${pos.y}px)`,
                    ...font.mono,
                  }}
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={inView ? { opacity: 1, scale: 1 } : {}}
                  transition={{ ...ease, delay: 0.7 + 0.1 * i }}
                >
                  <span className="text-[10px] text-[#a78bfa] font-medium">{label}</span>
                </motion.div>
              );
            })}
          </div>
        </motion.div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Stats Bar
// ---------------------------------------------------------------------------

function StatsBar() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-40px" });

  return (
    <section ref={ref} className="border-t border-b border-[rgba(255,255,255,0.08)] bg-[#18181b]">
      <div className="max-w-5xl mx-auto grid grid-cols-2 md:grid-cols-4">
        {STATS_BAR.map((stat, i) => (
          <motion.div
            key={stat.label}
            className={`py-8 px-6 text-center ${i < STATS_BAR.length - 1 ? "md:border-r md:border-[rgba(255,255,255,0.08)]" : ""} ${i % 2 === 0 && i < 2 ? "border-r border-[rgba(255,255,255,0.08)] md:border-r" : ""}`}
            initial={{ opacity: 0, y: 15 }}
            animate={inView ? { opacity: 1, y: 0 } : {}}
            transition={{ ...ease, delay: 0.08 * i }}
          >
            <div
              className="text-3xl md:text-4xl font-bold text-[#7c3aed] mb-1"
              style={font.display}
            >
              {stat.value}
            </div>
            <div className="text-sm text-[#71717a]" style={{ ...font.body, fontWeight: 500 }}>
              {stat.label}
            </div>
          </motion.div>
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Built by devs, for devs
// ---------------------------------------------------------------------------

function BuiltByDevs() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });

  return (
    <section
      ref={ref}
      className="py-24 px-5"
      style={{
        background: "#09090b",
        backgroundImage:
          "radial-gradient(rgba(255,255,255,0.03) 1px, transparent 1px)",
        backgroundSize: "24px 24px",
      }}
    >
      <div className="max-w-7xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={ease}
        >
          <h2
            className="text-4xl font-bold text-[#fafafa] tracking-tight"
            style={font.display}
          >
            Built by devs, for devs
          </h2>
          <p
            className="mt-2 text-xl font-semibold text-[#a78bfa]"
            style={font.display}
          >
            -- infrastructure should feel like code.
          </p>
          <p
            className="mt-4 text-base text-[#a1a1aa] max-w-xl leading-relaxed"
            style={font.body}
          >
            Otterdeploy was born from frustration with bloated dashboards and
            point-and-click deploys. Everything is a command. Everything is
            scriptable. Everything lives in your terminal.
          </p>
        </motion.div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Bento Grid -- Developer Features
// ---------------------------------------------------------------------------

function BentoGrid() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });

  return (
    <section
      id="features"
      ref={ref}
      className="py-24 px-5 border-t border-[rgba(255,255,255,0.08)]"
      style={{
        background: "#09090b",
        backgroundImage:
          "radial-gradient(rgba(255,255,255,0.03) 1px, transparent 1px)",
        backgroundSize: "24px 24px",
      }}
    >
      <div className="max-w-5xl mx-auto">
        <motion.h2
          className="text-4xl font-bold text-[#fafafa] tracking-tight mb-10"
          style={font.display}
          initial={{ opacity: 0, y: 15 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={ease}
        >
          Developer features
        </motion.h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {/* CLI-First -- col-span-2 */}
          <motion.div
            className="md:col-span-2 rounded-xl border border-[rgba(255,255,255,0.08)] bg-[#18181b] p-6 hover:border-[#7c3aed]/30 transition-colors"
            initial={{ opacity: 0, scale: 0.97 }}
            animate={inView ? { opacity: 1, scale: 1 } : {}}
            transition={{ ...ease, delay: 0.05 }}
          >
            <div className="flex items-center gap-2 mb-2">
              <Terminal size={18} className="text-[#7c3aed]" />
              <h3 className="text-base font-semibold text-[#fafafa]" style={font.display}>
                CLI-First
              </h3>
              <span
                className="ml-auto px-2 py-0.5 rounded text-[10px] font-medium bg-[#7c3aed]/15 text-[#a78bfa]"
                style={font.mono}
              >
                CORE
              </span>
            </div>
            <p className="text-sm text-[#a1a1aa] mb-4 leading-relaxed" style={font.body}>
              Every operation is a single command. Scriptable, composable, pipe-friendly.
            </p>
            <TerminalWindow title="otter --help">
              <div className="text-xs leading-relaxed">
                {OTTER_HELP_LINES.map((line, i) => (
                  <div key={i} className="whitespace-pre">
                    {line.startsWith("$") ? (
                      <span className="text-[#fafafa]">{line}</span>
                    ) : line.startsWith("  ") && line.includes("  ") ? (
                      <span>
                        <span className="text-[#a78bfa]">{line.split(/\s{2,}/)[0]}</span>
                        <span className="text-[#71717a]">
                          {"        ".slice(line.split(/\s{2,}/)[0].length)}
                          {line.split(/\s{2,}/).slice(1).join("  ")}
                        </span>
                      </span>
                    ) : (
                      <span className="text-[#71717a]">{line || "\u00a0"}</span>
                    )}
                  </div>
                ))}
              </div>
            </TerminalWindow>
          </motion.div>

          {/* Config as Code -- 1x1 */}
          <motion.div
            className="rounded-xl border border-[rgba(255,255,255,0.08)] bg-[#18181b] p-6 hover:border-[#7c3aed]/30 transition-colors"
            initial={{ opacity: 0, scale: 0.97 }}
            animate={inView ? { opacity: 1, scale: 1 } : {}}
            transition={{ ...ease, delay: 0.1 }}
          >
            <div className="flex items-center gap-2 mb-2">
              <FileCode2 size={18} className="text-[#7c3aed]" />
              <h3 className="text-base font-semibold text-[#fafafa]" style={font.display}>
                Config as Code
              </h3>
            </div>
            <p className="text-sm text-[#a1a1aa] mb-4 leading-relaxed" style={font.body}>
              One YAML file. Version controlled. Reviewable in PRs.
            </p>
            <div
              className="rounded-lg border border-[rgba(255,255,255,0.08)] bg-[#111111] p-3 text-xs leading-relaxed"
              style={font.mono}
            >
              {YAML_SNIPPET.split("\n").map((line, i) => (
                <div key={i}>
                  {line.includes(":") ? (
                    <span>
                      <span className="text-[#a78bfa]">{line.split(":")[0]}:</span>
                      <span className="text-[#fafafa]">{line.slice(line.indexOf(":") + 1)}</span>
                    </span>
                  ) : (
                    <span className="text-[#71717a]">{line || "\u00a0"}</span>
                  )}
                </div>
              ))}
            </div>
          </motion.div>

          {/* Git Integration -- 1x1 */}
          <motion.div
            className="rounded-xl border border-[rgba(255,255,255,0.08)] bg-[#18181b] p-6 hover:border-[#7c3aed]/30 transition-colors"
            initial={{ opacity: 0, scale: 0.97 }}
            animate={inView ? { opacity: 1, scale: 1 } : {}}
            transition={{ ...ease, delay: 0.15 }}
          >
            <div className="flex items-center gap-2 mb-2">
              <GitBranch size={18} className="text-[#7c3aed]" />
              <h3 className="text-base font-semibold text-[#fafafa]" style={font.display}>
                Git Integration
              </h3>
            </div>
            <p className="text-sm text-[#a1a1aa] mb-4 leading-relaxed" style={font.body}>
              Push to deploy. Every branch gets a preview.
            </p>
            <div
              className="rounded-lg border border-[rgba(255,255,255,0.08)] bg-[#111111] p-3 text-xs leading-relaxed"
              style={font.mono}
            >
              {GIT_PUSH_LINES.map((line, i) => (
                <div key={i} className="whitespace-pre">
                  {line.startsWith("$") ? (
                    <span className="text-[#fafafa]">{line}</span>
                  ) : line.startsWith("\u2713") ? (
                    <span>
                      <span className="text-[#4ade80]">{line.slice(0, 1)}</span>
                      <span className="text-[#fafafa]">{line.slice(1)}</span>
                    </span>
                  ) : line.startsWith("http") ? (
                    <span className="text-[#22d3ee]">{line}</span>
                  ) : (
                    <span className="text-[#71717a]">{line || "\u00a0"}</span>
                  )}
                </div>
              ))}
            </div>
          </motion.div>

          {/* Env Management -- col-span-2 */}
          <motion.div
            className="md:col-span-2 rounded-xl border border-[rgba(255,255,255,0.08)] bg-[#18181b] p-6 hover:border-[#7c3aed]/30 transition-colors"
            initial={{ opacity: 0, scale: 0.97 }}
            animate={inView ? { opacity: 1, scale: 1 } : {}}
            transition={{ ...ease, delay: 0.2 }}
          >
            <div className="flex items-center gap-2 mb-2">
              <KeyRound size={18} className="text-[#7c3aed]" />
              <h3 className="text-base font-semibold text-[#fafafa]" style={font.display}>
                Env Management
              </h3>
            </div>
            <p className="text-sm text-[#a1a1aa] mb-4 leading-relaxed" style={font.body}>
              Cascading environments with inheritance. Override only what changes.
            </p>
            <div className="grid grid-cols-3 gap-3">
              {(["prod", "staging", "dev"] as const).map((env) => (
                <div
                  key={env}
                  className="rounded-lg border border-[rgba(255,255,255,0.08)] bg-[#111111] p-3"
                >
                  <div
                    className={`text-[10px] font-medium mb-2 uppercase tracking-wider ${
                      env === "prod"
                        ? "text-[#4ade80]"
                        : env === "staging"
                          ? "text-[#22d3ee]"
                          : "text-[#a78bfa]"
                    }`}
                    style={font.mono}
                  >
                    {env}
                  </div>
                  {ENV_DIAGRAM[env].map((line, i) => (
                    <div
                      key={i}
                      className={`text-[10px] leading-relaxed ${line.startsWith("\u2191") ? "text-[#71717a] italic" : "text-[#a1a1aa]"}`}
                      style={font.mono}
                    >
                      {line}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </motion.div>

          {/* Hot Reload -- 1x1 */}
          <motion.div
            className="rounded-xl border border-[rgba(255,255,255,0.08)] bg-[#18181b] p-6 hover:border-[#7c3aed]/30 transition-colors"
            initial={{ opacity: 0, scale: 0.97 }}
            animate={inView ? { opacity: 1, scale: 1 } : {}}
            transition={{ ...ease, delay: 0.25 }}
          >
            <div className="flex items-center gap-2 mb-2">
              <Flame size={18} className="text-[#7c3aed]" />
              <h3 className="text-base font-semibold text-[#fafafa]" style={font.display}>
                Hot Reload
              </h3>
            </div>
            <p className="text-sm text-[#a1a1aa] mb-4 leading-relaxed" style={font.body}>
              Production-mirrored local dev with instant feedback.
            </p>
            <div
              className="rounded-lg border border-[rgba(255,255,255,0.08)] bg-[#111111] p-3 text-xs leading-relaxed"
              style={font.mono}
            >
              <div className="text-[#fafafa]">$ otter dev</div>
              <div className="text-[#71717a]">&nbsp;</div>
              <div>
                <span className="text-[#4ade80]">{"\u2713"}</span>
                <span className="text-[#fafafa]"> Watching ./src</span>
              </div>
              <div>
                <span className="text-[#4ade80]">{"\u2713"}</span>
                <span className="text-[#fafafa]"> Hot reload enabled</span>
              </div>
              <div>
                <span className="text-[#22d3ee]">{"\u25b8"}</span>
                <span className="text-[#a1a1aa]"> localhost:3000</span>
              </div>
            </div>
          </motion.div>

          {/* Type-Safe Config -- 1x1 */}
          <motion.div
            className="rounded-xl border border-[rgba(255,255,255,0.08)] bg-[#18181b] p-6 hover:border-[#7c3aed]/30 transition-colors"
            initial={{ opacity: 0, scale: 0.97 }}
            animate={inView ? { opacity: 1, scale: 1 } : {}}
            transition={{ ...ease, delay: 0.3 }}
          >
            <div className="flex items-center gap-2 mb-2">
              <ShieldCheck size={18} className="text-[#7c3aed]" />
              <h3 className="text-base font-semibold text-[#fafafa]" style={font.display}>
                Type-Safe Config
              </h3>
            </div>
            <p className="text-sm text-[#a1a1aa] mb-4 leading-relaxed" style={font.body}>
              Schema validation catches errors before deploy.
            </p>
            <div
              className="rounded-lg border border-[rgba(255,255,255,0.08)] bg-[#111111] p-3 text-xs leading-relaxed"
              style={font.mono}
            >
              <div className="text-[#fafafa]">$ otter validate</div>
              <div className="text-[#71717a]">&nbsp;</div>
              <div>
                <span className="text-[#4ade80]">{"\u2713"}</span>
                <span className="text-[#fafafa]"> Schema valid</span>
              </div>
              <div>
                <span className="text-[#4ade80]">{"\u2713"}</span>
                <span className="text-[#fafafa]"> Env vars resolved</span>
              </div>
              <div>
                <span className="text-[#4ade80]">{"\u2713"}</span>
                <span className="text-[#fafafa]"> Types checked</span>
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Feature Tabs -- "One CLI. Every operation."
// ---------------------------------------------------------------------------

function FeatureTabs() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });
  const [activeTab, setActiveTab] = useState<TabKey>("init");

  const data = FEATURE_TABS_DATA[activeTab];

  return (
    <section
      ref={ref}
      className="py-24 px-5"
      style={{
        background: `radial-gradient(ellipse at 50% 0%, rgba(124,58,237,0.15) 0%, transparent 50%),
                     radial-gradient(ellipse at 80% 60%, rgba(59,130,246,0.08) 0%, transparent 40%),
                     #09090b`,
      }}
    >
      <div className="max-w-6xl mx-auto">
        <motion.h2
          className="text-3xl md:text-4xl font-bold text-[#fafafa] text-center tracking-tight mb-3"
          style={font.display}
          initial={{ opacity: 0, y: 15 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={ease}
        >
          One CLI. Every operation.
        </motion.h2>
        <motion.p
          className="text-base text-[#a1a1aa] text-center mb-10 max-w-lg mx-auto"
          style={font.body}
          initial={{ opacity: 0, y: 10 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ ...ease, delay: 0.08 }}
        >
          From project init to production logs -- every workflow lives in your terminal.
        </motion.p>

        <motion.div
          className="flex items-center justify-center gap-1 mb-10 flex-wrap"
          initial={{ opacity: 0 }}
          animate={inView ? { opacity: 1 } : {}}
          transition={{ ...ease, delay: 0.15 }}
        >
          {(Object.keys(FEATURE_TABS_DATA) as TabKey[]).map((key) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={`px-4 py-2 text-sm rounded-lg transition-colors ${
                activeTab === key
                  ? "bg-[#7c3aed]/15 text-[#a78bfa]"
                  : "text-[#71717a] hover:text-[#fafafa]"
              }`}
              style={{ ...font.mono, fontWeight: 500 }}
            >
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

          <TerminalWindow title={`otter ${activeTab}`}>
            <div className="text-xs leading-relaxed whitespace-pre">
              {data.code.split("\n").map((line, i) => {
                if (line.startsWith("#")) {
                  return <div key={i} className="text-[#71717a]">{line}</div>;
                }
                if (line.startsWith("$")) {
                  return <div key={i} className="text-[#fafafa]">{line}</div>;
                }
                if (line.startsWith("\u25b8")) {
                  return <div key={i} className="text-[#a1a1aa]">{line}</div>;
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
                            {line.split("\u2192")[1].trim()}
                          </span>
                        </>
                      )}
                    </div>
                  );
                }
                if (line.startsWith("-")) {
                  return <div key={i} className="text-[#f87171]">{line}</div>;
                }
                if (line.startsWith("+")) {
                  return <div key={i} className="text-[#4ade80]">{line}</div>;
                }
                if (line.includes(":") && !line.startsWith(" ")) {
                  const colonIdx = line.indexOf(":");
                  return (
                    <div key={i}>
                      <span className="text-[#a78bfa]">{line.slice(0, colonIdx + 1)}</span>
                      <span className="text-[#fafafa]">{line.slice(colonIdx + 1)}</span>
                    </div>
                  );
                }
                return <div key={i} className="text-[#fafafa]">{line || "\u00a0"}</div>;
              })}
            </div>
          </TerminalWindow>
        </motion.div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Community Testimonials
// ---------------------------------------------------------------------------

function Testimonials() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });

  return (
    <section
      ref={ref}
      className="py-24 px-5 border-t border-[rgba(255,255,255,0.08)]"
      style={{
        background: "#09090b",
        backgroundImage:
          "radial-gradient(rgba(255,255,255,0.03) 1px, transparent 1px)",
        backgroundSize: "24px 24px",
      }}
    >
      <div className="max-w-5xl mx-auto">
        <motion.h2
          className="text-3xl md:text-4xl font-bold text-[#fafafa] tracking-tight text-center mb-3"
          style={font.display}
          initial={{ opacity: 0, y: 15 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={ease}
        >
          Loved by developers
        </motion.h2>
        <motion.p
          className="text-base text-[#a1a1aa] text-center mb-12 max-w-md mx-auto"
          style={font.body}
          initial={{ opacity: 0, y: 10 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ ...ease, delay: 0.08 }}
        >
          Hear from engineers who switched to a CLI-first workflow.
        </motion.p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {TESTIMONIALS.map((t, i) => (
            <motion.div
              key={t.author}
              className="rounded-xl border border-[rgba(255,255,255,0.08)] bg-[#18181b] p-6 hover:border-[#7c3aed]/30 transition-colors"
              initial={{ opacity: 0, y: 15 }}
              animate={inView ? { opacity: 1, y: 0 } : {}}
              transition={{ ...ease, delay: 0.1 + 0.08 * i }}
            >
              <Quote size={20} className="text-[#7c3aed]/40 mb-3" />
              <p
                className="text-sm text-[#a1a1aa] leading-relaxed mb-6"
                style={font.body}
              >
                "{t.quote}"
              </p>
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-[#7c3aed]/15 border border-[rgba(255,255,255,0.08)] flex items-center justify-center">
                  <span className="text-[10px] font-medium text-[#a78bfa]" style={font.mono}>
                    {t.initials}
                  </span>
                </div>
                <div>
                  <div className="text-sm font-medium text-[#fafafa]" style={font.display}>
                    {t.author}
                  </div>
                  <div className="text-xs text-[#71717a]" style={font.body}>
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
// Dev Stats
// ---------------------------------------------------------------------------

function DevStats() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-60px" });

  return (
    <section ref={ref} className="border-t border-b border-[rgba(255,255,255,0.08)] bg-[#18181b]">
      <div className="max-w-5xl mx-auto grid grid-cols-2 md:grid-cols-4">
        {DEV_STATS.map((stat, i) => (
          <motion.div
            key={stat.label}
            className={`py-10 px-6 text-center ${i < DEV_STATS.length - 1 ? "md:border-r md:border-[rgba(255,255,255,0.08)]" : ""} ${i % 2 === 0 && i < 2 ? "border-r border-[rgba(255,255,255,0.08)] md:border-r" : ""}`}
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
            <div className="text-sm text-[#71717a]" style={{ ...font.body, fontWeight: 500 }}>
              {stat.label}
            </div>
          </motion.div>
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Two Columns
// ---------------------------------------------------------------------------

function TwoColumns() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });

  const dxBullets = [
    "Autocomplete for every command and flag",
    "Inline documentation -- never leave the terminal",
    "Composable pipelines with Unix tooling",
    "Scriptable deploys for CI/CD integration",
    "Human-readable output, machine-parseable JSON mode",
  ];

  const escapeBullets = [
    "No clicking through 12 tabs to deploy",
    "No loading spinners on a settings page",
    "No browser required -- SSH in and ship",
    "No seat-based pricing for a deploy button",
    "No context switching between editor and browser",
  ];

  return (
    <section
      ref={ref}
      className="py-24 px-5 border-t border-[rgba(255,255,255,0.08)]"
      style={{
        background: "#09090b",
        backgroundImage:
          "radial-gradient(rgba(255,255,255,0.03) 1px, transparent 1px)",
        backgroundSize: "24px 24px",
      }}
    >
      <div className="max-w-5xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-16">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ ...ease, delay: 0.05 }}
        >
          <h3 className="text-2xl font-bold text-[#fafafa] mb-6" style={font.display}>
            Developer experience you deserve
          </h3>
          <ul className="flex flex-col gap-3">
            {dxBullets.map((b) => (
              <li key={b} className="flex items-start gap-3">
                <span className="w-1.5 h-1.5 rounded-full bg-[#7c3aed] mt-2 shrink-0" />
                <span className="text-sm text-[#a1a1aa] leading-relaxed" style={font.body}>
                  {b}
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
          <h3 className="text-2xl font-bold text-[#fafafa] mb-6" style={font.display}>
            Escape the dashboard trap
          </h3>
          <ul className="flex flex-col gap-3">
            {escapeBullets.map((b, i) => (
              <li key={b} className="flex items-start gap-3">
                <div className="flex items-center gap-2">
                  <span className="w-6 h-6 rounded-full bg-[#7c3aed]/10 border border-[rgba(255,255,255,0.08)] flex items-center justify-center shrink-0">
                    <ChevronRight size={12} className="text-[#a78bfa]" />
                  </span>
                </div>
                <span className="text-sm text-[#a1a1aa] leading-relaxed pt-0.5" style={font.body}>
                  {b}
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
// Pricing
// ---------------------------------------------------------------------------

function Pricing() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });

  return (
    <section
      ref={ref}
      className="py-24 px-5 border-t border-[rgba(255,255,255,0.08)]"
      style={{ background: "#09090b" }}
    >
      <div className="max-w-5xl mx-auto">
        <motion.div
          className="text-center mb-10"
          initial={{ opacity: 0, y: 15 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={ease}
        >
          <h2 className="text-3xl font-bold text-[#fafafa] tracking-tight" style={font.display}>
            Free forever. Seriously.
          </h2>
          <p className="mt-2 text-base text-[#a1a1aa]" style={font.body}>
            The CLI and core platform are MIT licensed. Enterprise support funds development.
          </p>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {/* Open Source */}
          <motion.div
            className="rounded-xl border-2 border-[#7c3aed] bg-[#18181b] p-8"
            initial={{ opacity: 0, y: 15 }}
            animate={inView ? { opacity: 1, y: 0 } : {}}
            transition={{ ...ease, delay: 0.05 }}
          >
            <span className="text-xs text-[#7c3aed] uppercase tracking-wider font-medium" style={font.mono}>
              Open Source
            </span>
            <div className="text-4xl font-bold text-[#fafafa] mt-2" style={font.display}>
              $0
            </div>
            <p className="text-sm text-[#a1a1aa] mt-2 leading-relaxed" style={font.body}>
              Full CLI, unlimited deploys, unlimited services, community support.
            </p>
            <div className="mt-4 flex flex-col gap-2">
              {["Full CLI access", "Unlimited deploys", "Git-driven workflows", "Community support"].map((f) => (
                <div key={f} className="flex items-center gap-2">
                  <Check size={14} className="text-[#4ade80]" />
                  <span className="text-xs text-[#a1a1aa]" style={font.body}>{f}</span>
                </div>
              ))}
            </div>
          </motion.div>

          {/* Team */}
          <motion.div
            className="rounded-xl border border-[rgba(255,255,255,0.08)] bg-[#18181b] p-8 hover:border-[#7c3aed]/30 transition-colors"
            initial={{ opacity: 0, y: 15 }}
            animate={inView ? { opacity: 1, y: 0 } : {}}
            transition={{ ...ease, delay: 0.1 }}
          >
            <span className="text-xs text-[#71717a] uppercase tracking-wider" style={font.mono}>
              Team
            </span>
            <div className="mt-2">
              <span className="text-4xl font-bold text-[#fafafa]" style={font.display}>
                $29
              </span>
              <span className="text-sm text-[#71717a] ml-1">/mo</span>
            </div>
            <p className="text-sm text-[#a1a1aa] mt-2 leading-relaxed" style={font.body}>
              Priority support, RBAC, audit logs, and team collaboration features.
            </p>
            <div className="mt-4 flex flex-col gap-2">
              {["Everything in OSS", "Role-based access", "Audit logs", "Priority support"].map((f) => (
                <div key={f} className="flex items-center gap-2">
                  <Check size={14} className="text-[#7c3aed]" />
                  <span className="text-xs text-[#a1a1aa]" style={font.body}>{f}</span>
                </div>
              ))}
            </div>
          </motion.div>

          {/* Enterprise */}
          <motion.div
            className="rounded-xl border border-[rgba(255,255,255,0.08)] bg-[#18181b] p-8 hover:border-[#7c3aed]/30 transition-colors"
            initial={{ opacity: 0, y: 15 }}
            animate={inView ? { opacity: 1, y: 0 } : {}}
            transition={{ ...ease, delay: 0.15 }}
          >
            <span className="text-xs text-[#71717a] uppercase tracking-wider" style={font.mono}>
              Enterprise
            </span>
            <div className="text-4xl font-bold text-[#fafafa] mt-2" style={font.display}>
              Custom
            </div>
            <p className="text-sm text-[#a1a1aa] mt-2 leading-relaxed" style={font.body}>
              SLA, dedicated engineer, SSO, custom integrations, on-prem assistance.
            </p>
            <div className="mt-4 flex flex-col gap-2">
              {["Everything in Team", "SLA guarantee", "SSO / SAML", "Dedicated support"].map((f) => (
                <div key={f} className="flex items-center gap-2">
                  <Check size={14} className="text-[#7c3aed]" />
                  <span className="text-xs text-[#a1a1aa]" style={font.body}>{f}</span>
                </div>
              ))}
            </div>
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

  const installCmd = "npm install -g otterdeploy";

  const handleCopy = () => {
    navigator.clipboard.writeText(installCmd);
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
                     radial-gradient(ellipse at 30% 80%, rgba(59,130,246,0.1) 0%, transparent 50%),
                     #09090b`,
      }}
    >
      <div className="max-w-2xl mx-auto text-center">
        <motion.div
          className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-[rgba(255,255,255,0.08)] bg-[#18181b] mb-6"
          initial={{ opacity: 0, y: 10 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ ...ease, delay: 0.05 }}
        >
          <Zap size={14} className="text-[#a78bfa]" />
          <span className="text-xs text-[#a1a1aa]" style={font.mono}>
            Ready in 30 seconds
          </span>
        </motion.div>

        <motion.h2
          className="text-4xl md:text-5xl font-bold text-[#fafafa] tracking-tight"
          style={font.display}
          initial={{ opacity: 0, y: 20 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={ease}
        >
          Start shipping from
          <br />
          your <span className="text-[#7c3aed]">terminal</span>
        </motion.h2>

        <motion.p
          className="mt-4 text-base text-[#a1a1aa] max-w-md mx-auto"
          style={font.body}
          initial={{ opacity: 0, y: 10 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ ...ease, delay: 0.1 }}
        >
          Install the CLI, init your project, and deploy. No sign-up required.
        </motion.p>

        <motion.div
          className="mt-8"
          initial={{ opacity: 0, y: 15 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ ...ease, delay: 0.15 }}
        >
          <button
            onClick={handleCopy}
            className="w-full max-w-lg mx-auto flex items-center justify-between px-5 py-3.5 rounded-xl border border-[rgba(255,255,255,0.08)] bg-[#111111] hover:border-[#7c3aed]/40 transition-colors group"
          >
            <span className="text-sm" style={font.mono}>
              <span className="text-[#71717a]">$ </span>
              <span className="text-[#a78bfa]">{installCmd}</span>
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
              Quick Start <ArrowRight size={16} />
            </a>
            <a
              href="#"
              className="px-6 py-2.5 rounded-lg border border-[rgba(255,255,255,0.08)] text-[#fafafa] text-sm font-semibold hover:border-[#a1a1aa]/30 transition-colors inline-flex items-center gap-2"
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
      links: ["Documentation", "CLI Reference", "API Docs", "Changelog"],
    },
    {
      title: "Developers",
      links: ["Quick Start", "Examples", "Plugins", "Contributing"],
    },
    {
      title: "Company",
      links: ["About", "Blog", "Security", "License"],
    },
  ];

  return (
    <footer className="px-5 py-12 bg-[#09090b] border-t border-[rgba(255,255,255,0.08)]">
      <div className="max-w-7xl mx-auto">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
          {/* Brand */}
          <div>
            <div className="flex items-center gap-1 mb-3">
              <span className="text-[#fafafa] font-bold tracking-tight" style={font.display}>
                otterdeploy
              </span>
              <span className="w-1.5 h-1.5 rounded-full bg-[#7c3aed] inline-block mb-2" />
            </div>
            <p className="text-sm text-[#71717a] leading-relaxed" style={font.body}>
              CLI-first PaaS for developers who ship.
            </p>
            <div className="flex items-center gap-3 mt-4">
              <a href="#" className="text-[#71717a] hover:text-[#a1a1aa] transition-colors">
                <Github size={16} />
              </a>
              <a href="#" className="text-[#71717a] hover:text-[#a1a1aa] transition-colors">
                <MessageCircle size={16} />
              </a>
              <a href="#" className="text-[#71717a] hover:text-[#a1a1aa] transition-colors">
                <Star size={16} />
              </a>
            </div>
            <div className="flex items-center gap-1 mt-4">
              {VARIANT_LINKS.map((v) => (
                <Link
                  key={v.to}
                  to={v.to}
                  className={`w-6 h-6 flex items-center justify-center text-xs rounded transition-colors ${
                    v.to === "/12"
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
        </div>

        {/* Bottom */}
        <div className="mt-10 pt-6 border-t border-[rgba(255,255,255,0.08)] flex flex-wrap items-center justify-between gap-4">
          <span className="text-xs text-[#71717a]" style={font.mono}>
            &copy; 2026 otterdeploy &middot; MIT License
          </span>
          <span className="text-xs text-[#71717a] inline-flex items-center gap-1" style={font.mono}>
            built with <Heart size={10} className="text-[#7c3aed]" /> by developers, for developers
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
      style={{
        ...font.body,
        background: "#09090b",
        backgroundImage:
          "radial-gradient(rgba(255,255,255,0.03) 1px, transparent 1px)",
        backgroundSize: "24px 24px",
      }}
    >
      <Nav />
      <Hero />
      <StatsBar />
      <BuiltByDevs />
      <BentoGrid />
      <FeatureTabs />
      <Testimonials />
      <DevStats />
      <TwoColumns />
      <Pricing />
      <CTA />
      <Footer />
    </div>
  );
}
