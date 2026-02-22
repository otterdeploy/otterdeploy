import { createFileRoute, Link } from "@tanstack/react-router";
import { motion, useInView } from "motion/react";
import { useEffect, useRef, useState } from "react";
import {
  Terminal,
  GitBranch,
  FileCode,
  Layers,
  Zap,
  Shield,
  Github,
  ArrowRight,
  Copy,
  Check,
  Rocket,
  Eye,
  Lock,
  Settings,
  Twitter,
} from "lucide-react";

export const Route = createFileRoute("/7")({
  component: RouteComponent,
});

// ---------------------------------------------------------------------------
// Font Loader
// ---------------------------------------------------------------------------

function useFonts() {
  useEffect(() => {
    const id = "dev-terminal-fonts";
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
  { label: "6", to: "/6" },
  { label: "7", to: "/7" },
  { label: "8", to: "/8" },
  { label: "9", to: "/9" },
  { label: "10", to: "/10" },
];

const DEPLOY_LINES = [
  { text: "$ otter init", type: "command" as const, delay: 0 },
  { text: "\u2713 Created otterdeploy.yml", type: "success" as const, delay: 0.4 },
  { text: "\u2713 Detected: Node.js, PostgreSQL, Redis", type: "success" as const, delay: 0.7 },
  { text: "", type: "blank" as const, delay: 1.0 },
  { text: "$ otter env create staging --from production", type: "command" as const, delay: 1.2 },
  { text: "\u2713 Created staging environment", type: "success" as const, delay: 1.6 },
  { text: "\u2713 Inherited 12 config values, 3 secrets", type: "success" as const, delay: 1.9 },
  { text: "", type: "blank" as const, delay: 2.1 },
  { text: "$ otter deploy --env staging", type: "command" as const, delay: 2.3 },
  { text: "\u2192 Building...", type: "header" as const, delay: 2.6 },
  { text: "  \u2713 web     Built (cache hit) 2s", type: "success" as const, delay: 2.9 },
  { text: "  \u2713 api     Built in 4s", type: "success" as const, delay: 3.2 },
  { text: "\u2192 Deploying to staging...", type: "header" as const, delay: 3.5 },
  { text: "  \u2713 All services healthy", type: "success" as const, delay: 3.8 },
  { text: "  \u2192 https://staging.myapp.com", type: "url" as const, delay: 4.1 },
  { text: "", type: "blank" as const, delay: 4.3 },
  { text: "$ otter logs --service api --tail", type: "command" as const, delay: 4.5 },
  { text: "[api-01] 200 GET  /health     2ms", type: "log" as const, delay: 4.8 },
  { text: "[api-02] 201 POST /users     18ms", type: "log" as const, delay: 5.1 },
];

const TAB_DATA = {
  init: {
    label: "OTTER INIT",
    heading: "Scaffold in seconds",
    bullets: [
      "Auto-detect runtime and dependencies",
      "Generate config from existing Dockerfile",
      "Interactive or headless mode",
      "Pre-built templates for common stacks",
    ],
    code: `$ otter init
? Detected runtime: Node.js 20
? Found: package.json, Dockerfile, docker-compose.yml
? Services detected: 3

\u2713 Created otterdeploy.yml
\u2713 Created .otter/hooks/pre-deploy.sh
\u2713 Added .otter to .gitignore

\u25b8 Next: otter deploy --env dev`,
  },
  deploy: {
    label: "OTTER DEPLOY",
    heading: "Ship with confidence",
    bullets: [
      "Incremental builds with layer caching",
      "Zero-downtime rolling deploys",
      "Automatic rollback on health check failure",
      "Deploy previews for every branch",
    ],
    code: `$ otter deploy --env production
\u25b8 Building services...
  \u2713 web     Built (cache hit)     2s
  \u2713 api     Built                 4s
  \u2713 worker  Built (cache hit)     1s

\u25b8 Running pre-deploy hooks...
  \u2713 migrations applied (2 pending)

\u25b8 Deploying (zero-downtime)...
  \u2713 All services healthy
  \u2192 https://myapp.com

\u2713 Deploy #847 complete (12s)`,
  },
  logs: {
    label: "OTTER LOGS",
    heading: "Real-time visibility",
    bullets: [
      "Stream logs from all services",
      "Filter by service, level, or pattern",
      "JSON-aware pretty printing",
      "Pipe to any tool in your workflow",
    ],
    code: `$ otter logs --tail --all
[web-01]    200 GET  /           3ms
[api-01]    200 GET  /health     1ms
[api-02]    201 POST /users     12ms
[worker-01] \u2713 job:email queued
[api-01]    200 GET  /api/items  4ms
[web-02]    200 GET  /dashboard  8ms

$ otter logs --service api --level error
[api-01] 500 POST /webhooks   ERR: timeout`,
  },
  secrets: {
    label: "OTTER SECRETS",
    heading: "Encrypted by default",
    bullets: [
      "AES-256 encryption at rest",
      "Per-environment scoping",
      "Rotate without restarts",
      "Audit trail for every access",
    ],
    code: `$ otter secrets set DATABASE_URL --env production
? Enter value: ********
\u2713 Secret set (encrypted, production only)

$ otter secrets list --env production
NAME            ENV         UPDATED
DATABASE_URL    production  2m ago
REDIS_URL       production  1d ago
API_KEY         production  3d ago
SMTP_PASSWORD   production  1w ago

4 secrets in production`,
  },
  env: {
    label: "OTTER ENV",
    heading: "Environments as code",
    bullets: [
      "Inherit config from parent environments",
      "Override only what differs",
      "Branch-based preview environments",
      "Promote between envs with one command",
    ],
    code: `$ otter env list
NAME        BASE         SERVICES  STATUS
production  -            3         \u2713 active
staging     production   3         \u2713 active
dev         staging      3         \u2713 active
pr-142      dev          2         \u25cb pending

$ otter env promote staging --to production
\u25b8 Diffing staging vs production...
  2 config changes, 0 secret changes
\u2713 Promoted staging \u2192 production`,
  },
};

type TabKey = keyof typeof TAB_DATA;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const font = {
  display: { fontFamily: "'Plus Jakarta Sans', sans-serif" },
  body: { fontFamily: "'Plus Jakarta Sans', sans-serif" },
  mono: { fontFamily: "'JetBrains Mono', monospace" },
};

const ease = { type: "tween" as const, ease: "easeOut" as const, duration: 0.4 };

const AURORA = `radial-gradient(ellipse at 50% 0%, rgba(124,58,237,0.3) 0%, transparent 60%), radial-gradient(ellipse at 30% 50%, rgba(59,130,246,0.2) 0%, transparent 50%), radial-gradient(ellipse at 70% 50%, rgba(139,92,246,0.15) 0%, transparent 50%), #0a0a0a`;

function TerminalWindow({
  title,
  children,
  className = "",
  dark = true,
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
  dark?: boolean;
}) {
  return (
    <div
      className={`rounded-xl overflow-hidden border ${dark ? "border-[#262626]" : "border-[#e5e5e5]"} ${className}`}
      style={{ background: dark ? "#111111" : "#f8f8f8" }}
    >
      <div
        className={`flex items-center gap-2 px-4 py-2.5 border-b ${dark ? "border-[#262626]" : "border-[#e5e5e5]"}`}
      >
        <div className="flex gap-1.5">
          <div className={`w-3 h-3 rounded-full ${dark ? "bg-[#3b3b3b]" : "bg-[#d4d4d4]"}`} />
          <div className={`w-3 h-3 rounded-full ${dark ? "bg-[#3b3b3b]" : "bg-[#d4d4d4]"}`} />
          <div className={`w-3 h-3 rounded-full ${dark ? "bg-[#3b3b3b]" : "bg-[#d4d4d4]"}`} />
        </div>
        <span
          className={`text-xs ml-2 ${dark ? "text-[#737373]" : "text-[#999999]"}`}
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

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

function Nav() {
  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-white/90 backdrop-blur-xl border-b border-[#e5e5e5]">
      <div className="max-w-7xl mx-auto flex items-center justify-between px-5 py-3">
        <div className="flex items-center gap-1">
          <span
            className="text-[#0a0a0a] text-lg font-bold tracking-tight"
            style={font.display}
          >
            otterdeploy
          </span>
          <span className="w-1.5 h-1.5 rounded-full bg-[#7c3aed] inline-block mb-2" />
        </div>

        <div className="hidden md:flex items-center gap-6">
          <a
            href="#"
            className="text-sm text-[#666666] hover:text-[#0a0a0a] transition-colors"
            style={{ ...font.body, fontWeight: 500 }}
          >
            Documentation
          </a>
          <a
            href="#"
            className="text-sm text-[#666666] hover:text-[#0a0a0a] transition-colors"
            style={{ ...font.body, fontWeight: 500 }}
          >
            CLI Reference
          </a>
        </div>

        <div className="flex items-center gap-2">
          <div className="hidden sm:flex items-center gap-1 mr-2">
            {VARIANT_LINKS.map((v) => (
              <Link
                key={v.to}
                to={v.to}
                className={`w-7 h-7 flex items-center justify-center text-xs rounded transition-colors ${
                  v.to === "/7"
                    ? "bg-[#7c3aed]/15 text-[#7c3aed] font-medium"
                    : "text-[#999999] hover:text-[#666666]"
                }`}
                style={font.mono}
              >
                {v.label}
              </Link>
            ))}
          </div>
          <a
            href="#cta"
            className="px-4 py-1.5 text-sm font-semibold rounded-lg bg-[#7c3aed] text-white hover:bg-[#6d28d9] transition-colors"
            style={font.display}
          >
            Get Started
          </a>
        </div>
      </div>
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Isometric Grid (Hero Visual) — Developer-focused labels
// ---------------------------------------------------------------------------

const GRID_CELLS = [
  { label: "web", r: 0, c: 0 },
  { label: "api", r: 0, c: 1 },
  { label: "worker", r: 0, c: 2 },
  { label: "db", r: 1, c: 0 },
  { label: "cache", r: 1, c: 1 },
  { label: "queue", r: 1, c: 2 },
  { label: "cron", r: 2, c: 0 },
  { label: "logs", r: 2, c: 1 },
  { label: "config", r: 2, c: 2 },
];

const SATELLITE_NODES = [
  { label: ".DOCKERFILE", x: -110, y: -40 },
  { label: ".YAML", x: 230, y: -50 },
  { label: ".GIT", x: 250, y: 120 },
  { label: ".ENV", x: -120, y: 80 },
  { label: ".SSH", x: -100, y: 170 },
];

function IsometricDiagram() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-40px" });

  return (
    <div ref={ref} className="flex justify-center mt-20">
      <div className="relative" style={{ width: 500, height: 380 }}>
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
            {GRID_CELLS.map((cell, i) => (
              <motion.div
                key={cell.label}
                className="w-[76px] h-[76px] rounded-lg border border-[#e5e5e5] bg-white flex items-center justify-center hover:border-[#7c3aed]/50 transition-colors"
                style={font.mono}
                initial={{ opacity: 0, scale: 0.5 }}
                animate={inView ? { opacity: 1, scale: 1 } : {}}
                transition={{ ...ease, delay: 0.08 * i, duration: 0.5 }}
              >
                <span className="text-[10px] text-[#666666] font-medium">
                  {cell.label}
                </span>
              </motion.div>
            ))}
          </div>
        </div>

        {SATELLITE_NODES.map((node, i) => (
          <motion.div
            key={node.label}
            className="absolute px-3 py-1.5 rounded-md border border-[#e5e5e5] bg-white"
            style={{
              left: `calc(50% + ${node.x}px)`,
              top: `calc(50% + ${node.y}px)`,
              ...font.mono,
            }}
            initial={{ opacity: 0, scale: 0.8 }}
            animate={inView ? { opacity: 1, scale: 1 } : {}}
            transition={{ ...ease, delay: 0.5 + 0.1 * i }}
          >
            <span className="text-[10px] text-[#7c3aed] font-medium">
              {node.label}
            </span>
          </motion.div>
        ))}

        <svg
          className="absolute inset-0 w-full h-full pointer-events-none"
          style={{ zIndex: -1 }}
        >
          {SATELLITE_NODES.map((node, i) => (
            <motion.line
              key={i}
              x1="50%"
              y1="50%"
              x2={`calc(50% + ${node.x + 30}px)`}
              y2={`calc(50% + ${node.y + 10}px)`}
              stroke="#e5e5e5"
              strokeWidth="1"
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
  const installCmd = "npm install -g otterdeploy";

  const handleCopy = () => {
    navigator.clipboard.writeText(installCmd);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <section ref={ref} className="pt-28 pb-16 px-5 bg-white">
      <div className="max-w-5xl mx-auto text-center">
        <motion.div
          className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-[#f3f0ff] mb-6"
          initial={{ opacity: 0, scale: 0.8 }}
          animate={inView ? { opacity: 1, scale: 1 } : {}}
          transition={{ ...ease, delay: 0.05 }}
        >
          <Terminal size={28} className="text-[#7c3aed]" />
        </motion.div>

        <motion.h1
          className="text-5xl md:text-7xl font-extrabold text-[#0a0a0a] leading-[1.1] tracking-tight"
          style={font.display}
          initial={{ opacity: 0, y: 20 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ ...ease, delay: 0.1 }}
        >
          Deploy from
          <br />
          Your <span className="text-[#7c3aed]">Terminal</span>
        </motion.h1>

        <motion.p
          className="mt-6 text-lg text-[#666666] max-w-2xl mx-auto leading-relaxed"
          style={{ ...font.body, fontWeight: 400 }}
          initial={{ opacity: 0, y: 15 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ ...ease, delay: 0.25 }}
        >
          A CLI-first platform that speaks your language. Config as code,
          git-driven deploys, zero dashboards required.
        </motion.p>

        <motion.div
          className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3"
          initial={{ opacity: 0, y: 10 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ ...ease, delay: 0.4 }}
        >
          <button
            onClick={handleCopy}
            className="px-6 py-2.5 text-sm rounded-lg bg-[#0a0a0a] text-[#4ade80] hover:bg-[#171717] transition-colors inline-flex items-center gap-3 group"
            style={font.mono}
          >
            <span>$ {installCmd}</span>
            {copied ? (
              <Check size={14} className="text-[#4ade80] shrink-0" />
            ) : (
              <Copy size={14} className="text-[#666666] group-hover:text-[#999999] transition-colors shrink-0" />
            )}
          </button>
          <a
            href="#"
            className="px-6 py-2.5 text-sm font-semibold rounded-lg border border-[#e5e5e5] text-[#0a0a0a] hover:border-[#d4d4d4] transition-colors inline-flex items-center gap-2"
            style={font.display}
          >
            <Github size={16} /> View on GitHub
          </a>
        </motion.div>

        <IsometricDiagram />
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Built by Developers Section
// ---------------------------------------------------------------------------

function BuiltByDevelopers() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });

  return (
    <section
      ref={ref}
      className="py-24 px-5 bg-[#f8f8f8] border-t border-[#e5e5e5]"
    >
      <div className="max-w-7xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={ease}
        >
          <h2
            className="text-4xl font-bold text-[#0a0a0a] tracking-tight"
            style={font.display}
          >
            Built by developers, for developers
          </h2>
          <p
            className="mt-2 text-xl font-semibold text-[#0a0a0a]"
            style={font.display}
          >
            — stop clicking through dashboards.
          </p>
          <p
            className="mt-4 text-base text-[#666666] max-w-xl leading-relaxed"
            style={font.body}
          >
            Every operation is a CLI command. Every config is a file in your
            repo. Every deploy is a git push.
          </p>
        </motion.div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Dark Terminal Section
// ---------------------------------------------------------------------------

function DarkTerminalSection() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-60px" });
  const [visibleLines, setVisibleLines] = useState(0);

  useEffect(() => {
    if (!inView) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    DEPLOY_LINES.forEach((line, i) => {
      timers.push(setTimeout(() => setVisibleLines(i + 1), line.delay * 1000));
    });
    return () => timers.forEach(clearTimeout);
  }, [inView]);

  return (
    <section
      ref={ref}
      className="py-24 px-5"
      style={{ background: AURORA }}
    >
      <div className="max-w-3xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={ease}
        >
          <TerminalWindow title="Terminal — developer workflow">
            <div className="text-sm leading-relaxed min-h-[340px]">
              {DEPLOY_LINES.slice(0, visibleLines).map((line, i) => (
                <div key={i} className="whitespace-pre">
                  {line.type === "command" && (
                    <span className="text-[#fafafa]">{line.text}</span>
                  )}
                  {line.type === "blank" && <br />}
                  {line.type === "header" && (
                    <span className="text-[#999999]">{line.text}</span>
                  )}
                  {line.type === "success" && (
                    <span>
                      <span className="text-[#4ade80]">
                        {line.text.slice(0, line.text.indexOf("\u2713") + 1)}
                      </span>
                      <span className="text-[#fafafa]">
                        {line.text.slice(line.text.indexOf("\u2713") + 1)}
                      </span>
                    </span>
                  )}
                  {line.type === "url" && (
                    <span>
                      <span className="text-[#999999]">{"  \u2192 "}</span>
                      <span className="text-[#22d3ee]">
                        {line.text.replace("  \u2192 ", "")}
                      </span>
                    </span>
                  )}
                  {line.type === "log" && (
                    <span>
                      <span className="text-[#a78bfa]">
                        {line.text.match(/\[.*?\]/)?.[0]}
                      </span>
                      <span className="text-[#4ade80]">
                        {" "}{line.text.match(/\d{3}/)?.[0]}
                      </span>
                      <span className="text-[#fafafa]">
                        {line.text.slice((line.text.match(/\d{3}/)?.index ?? 0) + 3)}
                      </span>
                    </span>
                  )}
                </div>
              ))}
              {visibleLines < DEPLOY_LINES.length && inView && (
                <span className="inline-block w-2 h-4 bg-[#a78bfa] animate-pulse" />
              )}
            </div>
          </TerminalWindow>
        </motion.div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Bento Grid — Developer-Focused Features
// ---------------------------------------------------------------------------

function BentoGrid() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });

  const helpSnippet = `$ otter --help

Usage: otter <command> [options]

Commands:
  init        Scaffold a new project
  deploy      Deploy services
  logs        Stream service logs
  env         Manage environments
  secrets     Manage secrets
  scale       Scale services
  rollback    Rollback a deploy
  dev         Start local dev`;

  const yamlSnippet = `# otterdeploy.yml
name: myapp
services:
  web:
    build: ./app
    port: 3000
    replicas: 2
  api:
    build: ./server
    port: 8080`;

  const gitSnippet = `$ git push origin main
\u25b8 deploy triggered \u2192 #1248
\u2713 production live (12s)`;

  const devSnippet = `$ otter dev
\u2713 mirroring production
\u25b8 web     localhost:3000
\u25b8 api     localhost:8080
\u25b8 postgres localhost:5432`;

  return (
    <section
      id="features"
      ref={ref}
      className="py-24 px-5 bg-white border-t border-[#e5e5e5]"
    >
      <div className="max-w-5xl mx-auto">
        <motion.h2
          className="text-4xl font-bold text-[#0a0a0a] tracking-tight mb-10"
          style={font.display}
          initial={{ opacity: 0, y: 15 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={ease}
        >
          Your entire workflow, one tool
        </motion.h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {/* CLI-First — 2 cols */}
          <motion.div
            className="md:col-span-2 rounded-xl border border-[#e5e5e5] bg-white p-6 hover:border-[#7c3aed]/30 transition-colors"
            initial={{ opacity: 0, scale: 0.97 }}
            animate={inView ? { opacity: 1, scale: 1 } : {}}
            transition={{ ...ease, delay: 0.05 }}
          >
            <div className="flex items-center gap-2 mb-2">
              <Terminal size={18} className="text-[#7c3aed]" />
              <h3
                className="text-base font-semibold text-[#0a0a0a]"
                style={font.display}
              >
                CLI-First
              </h3>
            </div>
            <p
              className="text-sm text-[#666666] mb-4 leading-relaxed"
              style={font.body}
            >
              Every operation is a command. Tab-complete everything.
              No browser required.
            </p>
            <div
              className="rounded-lg bg-[#0a0a0a] p-4 text-xs leading-relaxed overflow-x-auto"
              style={font.mono}
            >
              {helpSnippet.split("\n").map((line, i) => (
                <div key={i} className="whitespace-pre">
                  {line.startsWith("$") ? (
                    <span className="text-[#fafafa]">{line}</span>
                  ) : line.startsWith("Usage") || line.startsWith("Commands") ? (
                    <span className="text-[#999999]">{line}</span>
                  ) : line.match(/^\s{2}\w/) ? (
                    <span>
                      <span className="text-[#a78bfa]">
                        {"  "}{line.trim().split(/\s{2,}/)[0]}
                      </span>
                      <span className="text-[#666666]">
                        {"        ".slice(line.trim().split(/\s{2,}/)[0].length)}
                        {line.trim().split(/\s{2,}/)[1] || ""}
                      </span>
                    </span>
                  ) : (
                    <span className="text-[#fafafa]">{line || "\u00a0"}</span>
                  )}
                </div>
              ))}
            </div>
          </motion.div>

          {/* Config as Code — 1x1 */}
          <motion.div
            className="rounded-xl border border-[#e5e5e5] bg-white p-6 hover:border-[#7c3aed]/30 transition-colors"
            initial={{ opacity: 0, scale: 0.97 }}
            animate={inView ? { opacity: 1, scale: 1 } : {}}
            transition={{ ...ease, delay: 0.1 }}
          >
            <div className="flex items-center gap-2 mb-2">
              <FileCode size={18} className="text-[#7c3aed]" />
              <h3
                className="text-base font-semibold text-[#0a0a0a]"
                style={font.display}
              >
                Config as Code
              </h3>
            </div>
            <p
              className="text-sm text-[#666666] mb-4 leading-relaxed"
              style={font.body}
            >
              One YAML file, version-controlled, auditable.
            </p>
            <div
              className="rounded-lg border border-[#e5e5e5] bg-[#f8f8f8] p-3 text-[11px] leading-relaxed"
              style={font.mono}
            >
              {yamlSnippet.split("\n").map((line, i) => (
                <div key={i}>
                  {line.startsWith("#") ? (
                    <span className="text-[#999999]">{line}</span>
                  ) : line.includes(":") ? (
                    <span>
                      <span className="text-[#7c3aed]">
                        {line.split(":")[0]}:
                      </span>
                      <span className="text-[#0a0a0a]">
                        {line.slice(line.indexOf(":") + 1)}
                      </span>
                    </span>
                  ) : (
                    <span className="text-[#0a0a0a]">{line}</span>
                  )}
                </div>
              ))}
            </div>
          </motion.div>

          {/* Git Integration — 1x1 */}
          <motion.div
            className="rounded-xl border border-[#e5e5e5] bg-white p-6 hover:border-[#7c3aed]/30 transition-colors"
            initial={{ opacity: 0, scale: 0.97 }}
            animate={inView ? { opacity: 1, scale: 1 } : {}}
            transition={{ ...ease, delay: 0.15 }}
          >
            <div className="flex items-center gap-2 mb-2">
              <GitBranch size={18} className="text-[#7c3aed]" />
              <h3
                className="text-base font-semibold text-[#0a0a0a]"
                style={font.display}
              >
                Git Integration
              </h3>
            </div>
            <p
              className="text-sm text-[#666666] mb-4 leading-relaxed"
              style={font.body}
            >
              Push to deploy. Every branch gets a preview.
            </p>
            <div
              className="rounded-lg bg-[#0a0a0a] p-3 text-[11px] leading-relaxed text-[#4ade80]"
              style={font.mono}
            >
              {gitSnippet.split("\n").map((line, i) => (
                <div key={i} className="whitespace-pre">
                  {line}
                </div>
              ))}
            </div>
          </motion.div>

          {/* Environment Management — col-span-2 */}
          <motion.div
            className="md:col-span-2 rounded-xl border border-[#e5e5e5] bg-white p-6 hover:border-[#7c3aed]/30 transition-colors"
            initial={{ opacity: 0, scale: 0.97 }}
            animate={inView ? { opacity: 1, scale: 1 } : {}}
            transition={{ ...ease, delay: 0.2 }}
          >
            <div className="flex items-center gap-2 mb-2">
              <Layers size={18} className="text-[#7c3aed]" />
              <h3
                className="text-base font-semibold text-[#0a0a0a]"
                style={font.display}
              >
                Environment Management
              </h3>
            </div>
            <p
              className="text-sm text-[#666666] mb-4 leading-relaxed"
              style={font.body}
            >
              Inherit, override, branch. Environments that mirror your git workflow.
            </p>
            <div className="flex items-center gap-3 flex-wrap">
              {[
                { name: "production", color: "bg-green-50 text-green-700 border-green-200" },
                { name: "staging", color: "bg-purple-50 text-purple-700 border-purple-200" },
                { name: "dev", color: "bg-blue-50 text-blue-700 border-blue-200" },
              ].map((env, i) => (
                <div key={env.name} className="flex items-center gap-2">
                  <span className={`px-3 py-1.5 rounded-md text-xs font-medium border ${env.color}`} style={font.mono}>
                    {env.name}
                  </span>
                  {i < 2 && (
                    <ArrowRight size={14} className="text-[#999999]" />
                  )}
                </div>
              ))}
              <span className="text-xs text-[#999999] ml-1" style={font.mono}>
                inherits down
              </span>
            </div>
          </motion.div>

          {/* Hot Reload — 1x1 */}
          <motion.div
            className="rounded-xl border border-[#e5e5e5] bg-white p-6 hover:border-[#7c3aed]/30 transition-colors"
            initial={{ opacity: 0, scale: 0.97 }}
            animate={inView ? { opacity: 1, scale: 1 } : {}}
            transition={{ ...ease, delay: 0.25 }}
          >
            <div className="flex items-center gap-2 mb-2">
              <Zap size={18} className="text-[#7c3aed]" />
              <h3
                className="text-base font-semibold text-[#0a0a0a]"
                style={font.display}
              >
                Hot Reload
              </h3>
            </div>
            <p
              className="text-sm text-[#666666] mb-4 leading-relaxed"
              style={font.body}
            >
              Local dev that mirrors production.
            </p>
            <div
              className="rounded-lg bg-[#0a0a0a] p-3 text-[11px] leading-relaxed"
              style={font.mono}
            >
              {devSnippet.split("\n").map((line, i) => (
                <div key={i} className="whitespace-pre">
                  {line.startsWith("$") ? (
                    <span className="text-[#fafafa]">{line}</span>
                  ) : line.includes("\u2713") ? (
                    <span className="text-[#4ade80]">{line}</span>
                  ) : (
                    <span className="text-[#22d3ee]">{line}</span>
                  )}
                </div>
              ))}
            </div>
          </motion.div>

          {/* Type-Safe Config — 1x1 */}
          <motion.div
            className="rounded-xl border border-[#e5e5e5] bg-white p-6 hover:border-[#7c3aed]/30 transition-colors"
            initial={{ opacity: 0, scale: 0.97 }}
            animate={inView ? { opacity: 1, scale: 1 } : {}}
            transition={{ ...ease, delay: 0.3 }}
          >
            <div className="flex items-center gap-2 mb-2">
              <Shield size={18} className="text-[#7c3aed]" />
              <h3
                className="text-base font-semibold text-[#0a0a0a]"
                style={font.display}
              >
                Type-Safe Config
              </h3>
            </div>
            <p
              className="text-sm text-[#666666] leading-relaxed"
              style={font.body}
            >
              Schema validation catches errors before deploy. Get instant
              feedback in your editor with JSON Schema autocomplete.
            </p>
            <div className="flex justify-center py-3">
              <div className="px-3 py-1.5 rounded-md bg-[#f3f0ff] border border-[#7c3aed]/20">
                <span className="text-xs text-[#7c3aed] font-medium" style={font.mono}>
                  0 errors, 0 warnings
                </span>
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Feature Tabs (Dark Aurora Section)
// ---------------------------------------------------------------------------

function FeatureTabs() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });
  const [activeTab, setActiveTab] = useState<TabKey>("init");

  const tabIcons: Record<TabKey, React.ReactNode> = {
    init: <Rocket size={16} />,
    deploy: <ArrowRight size={16} />,
    logs: <Eye size={16} />,
    secrets: <Lock size={16} />,
    env: <Settings size={16} />,
  };

  const data = TAB_DATA[activeTab];

  return (
    <section
      ref={ref}
      className="py-24 px-5"
      style={{ background: AURORA }}
    >
      <div className="max-w-6xl mx-auto">
        <motion.h2
          className="text-3xl md:text-4xl font-bold text-[#fafafa] text-center tracking-tight mb-10"
          style={font.display}
          initial={{ opacity: 0, y: 15 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={ease}
        >
          One CLI. Every operation.
        </motion.h2>

        <motion.div
          className="flex items-center justify-center gap-1 mb-10 flex-wrap"
          initial={{ opacity: 0 }}
          animate={inView ? { opacity: 1 } : {}}
          transition={{ ...ease, delay: 0.15 }}
        >
          {(Object.keys(TAB_DATA) as TabKey[]).map((key) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={`flex items-center gap-2 px-4 py-2 text-sm rounded-lg transition-colors ${
                activeTab === key
                  ? "bg-[#7c3aed]/20 text-[#a78bfa]"
                  : "text-[#999999] hover:text-[#fafafa]"
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
              className="text-xs text-[#a78bfa] uppercase tracking-wider mb-3 block"
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
                    className="text-sm text-[#999999]"
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
                    <div key={i} className="text-[#666666]">{line}</div>
                  );
                }
                if (line.startsWith("$")) {
                  return (
                    <div key={i} className="text-[#fafafa]">{line}</div>
                  );
                }
                if (line.startsWith("?")) {
                  return (
                    <div key={i} className="text-[#22d3ee]">{line}</div>
                  );
                }
                if (line.startsWith("\u25b8")) {
                  return (
                    <div key={i} className="text-[#999999]">{line}</div>
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
                          <span className="text-[#666666]">{"\u2192 "}</span>
                          <span className="text-[#a78bfa]">
                            {line.split("\u2192")[1].trim()}
                          </span>
                        </>
                      )}
                    </div>
                  );
                }
                if (line.includes("\u25cb")) {
                  return (
                    <div key={i} className="text-[#999999]">{line}</div>
                  );
                }
                if (line.match(/^NAME\s/) || line.match(/^\d+ secret/)) {
                  return (
                    <div key={i} className="text-[#999999]">{line}</div>
                  );
                }
                if (line.includes(":") && !line.startsWith(" ")) {
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
                  <div key={i} className="text-[#fafafa]">{line || "\u00a0"}</div>
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
// Stats Row
// ---------------------------------------------------------------------------

const STATS = [
  { value: "12s", label: "avg deploy" },
  { value: "1", label: "config file" },
  { value: "0", label: "dashboards needed" },
  { value: "\u221e", label: "extensibility" },
];

function StatsRow() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-60px" });

  return (
    <section
      ref={ref}
      className="border-t border-b border-[#e5e5e5] bg-white"
    >
      <div className="max-w-5xl mx-auto grid grid-cols-2 md:grid-cols-4">
        {STATS.map((stat, i) => (
          <motion.div
            key={stat.label}
            className={`py-10 px-6 text-center ${i < STATS.length - 1 ? "md:border-r md:border-[#e5e5e5]" : ""} ${i % 2 === 0 && i < 2 ? "border-r border-[#e5e5e5] md:border-r" : ""}`}
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
              className="text-sm text-[#666666]"
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
// Two Columns
// ---------------------------------------------------------------------------

function TwoColumns() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });

  const dxBullets = [
    "Full CLI with tab completion and inline help",
    "Autocomplete for services, environments, and secrets",
    "Dry-run mode to preview changes before deploying",
    "Local dev environment that mirrors production exactly",
    "Pipe-friendly output for scripting and automation",
  ];

  return (
    <section
      ref={ref}
      className="py-24 px-5 bg-[#f8f8f8] border-t border-[#e5e5e5]"
    >
      <div className="max-w-5xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-16">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ ...ease, delay: 0.05 }}
        >
          <h3
            className="text-2xl font-bold text-[#0a0a0a] mb-6"
            style={font.display}
          >
            The developer experience you deserve
          </h3>
          <ul className="flex flex-col gap-3">
            {dxBullets.map((b) => (
              <li key={b} className="flex items-start gap-3">
                <span className="w-1.5 h-1.5 rounded-full bg-[#7c3aed] mt-2 shrink-0" />
                <span
                  className="text-sm text-[#666666] leading-relaxed"
                  style={font.body}
                >
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
          <h3
            className="text-2xl font-bold text-[#0a0a0a] mb-6"
            style={font.display}
          >
            Escape the dashboard trap
          </h3>
          <div className="flex flex-col gap-6">
            <div className="rounded-xl border border-[#e5e5e5] bg-white p-5">
              <span
                className="text-xs text-[#999999] uppercase tracking-wider block mb-3"
                style={font.mono}
              >
                With other tools
              </span>
              <div className="flex items-center gap-2 flex-wrap text-sm" style={font.body}>
                <span className="px-2.5 py-1 rounded-md bg-[#f8f8f8] border border-[#e5e5e5] text-[#666666]">Click</span>
                <span className="text-[#999999]">&rarr;</span>
                <span className="px-2.5 py-1 rounded-md bg-[#f8f8f8] border border-[#e5e5e5] text-[#666666]">Click</span>
                <span className="text-[#999999]">&rarr;</span>
                <span className="px-2.5 py-1 rounded-md bg-[#f8f8f8] border border-[#e5e5e5] text-[#666666]">Wait</span>
                <span className="text-[#999999]">&rarr;</span>
                <span className="px-2.5 py-1 rounded-md bg-[#f8f8f8] border border-[#e5e5e5] text-[#666666]">Click</span>
              </div>
            </div>
            <div className="rounded-xl border border-[#7c3aed]/30 bg-[#f3f0ff] p-5">
              <span
                className="text-xs text-[#7c3aed] uppercase tracking-wider block mb-3"
                style={font.mono}
              >
                With Otterdeploy
              </span>
              <div
                className="text-sm text-[#0a0a0a] leading-relaxed"
                style={font.mono}
              >
                <span className="text-[#7c3aed]">$</span> otter deploy{" "}
                <span className="text-[#4ade80] font-medium">Done.</span>
              </div>
            </div>
          </div>
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
    <section
      ref={ref}
      className="py-24 px-5 bg-white border-t border-[#e5e5e5]"
    >
      <div className="max-w-4xl mx-auto">
        <div className="grid grid-cols-1 md:grid-cols-3 border border-[#e5e5e5] rounded-xl overflow-hidden">
          {/* Free */}
          <motion.div
            className="p-8 border-b md:border-b-0 md:border-r border-[#e5e5e5]"
            initial={{ opacity: 0, y: 15 }}
            animate={inView ? { opacity: 1, y: 0 } : {}}
            transition={{ ...ease, delay: 0.05 }}
          >
            <span
              className="text-xs text-[#999999] uppercase tracking-wider"
              style={font.mono}
            >
              Free
            </span>
            <div
              className="text-4xl font-bold text-[#0a0a0a] mt-2"
              style={font.display}
            >
              $0
            </div>
            <p className="text-sm text-[#666666] mt-2 leading-relaxed" style={font.body}>
              All core features, unlimited deploys, community support. Open
              source forever.
            </p>
            <a
              href="#"
              className="mt-5 block text-center px-4 py-2 text-sm font-semibold rounded-lg border border-[#e5e5e5] text-[#0a0a0a] hover:border-[#d4d4d4] transition-colors"
              style={font.display}
            >
              Get Started
            </a>
          </motion.div>

          {/* Pro */}
          <motion.div
            className="p-8 border-b md:border-b-0 md:border-r border-[#e5e5e5] bg-[#f3f0ff]/30"
            initial={{ opacity: 0, y: 15 }}
            animate={inView ? { opacity: 1, y: 0 } : {}}
            transition={{ ...ease, delay: 0.1 }}
          >
            <span
              className="text-xs text-[#7c3aed] uppercase tracking-wider font-medium"
              style={font.mono}
            >
              Pro
            </span>
            <div className="mt-2">
              <span
                className="text-4xl font-bold text-[#0a0a0a]"
                style={font.display}
              >
                $29
              </span>
              <span className="text-sm text-[#999999] ml-1">/mo</span>
            </div>
            <p className="text-sm text-[#666666] mt-2 leading-relaxed" style={font.body}>
              Priority support, advanced RBAC, SSO, audit logs, and custom
              domains.
            </p>
            <a
              href="#"
              className="mt-5 block text-center px-4 py-2 text-sm font-semibold rounded-lg bg-[#7c3aed] text-white hover:bg-[#6d28d9] transition-colors"
              style={font.display}
            >
              Upgrade
            </a>
          </motion.div>

          {/* Enterprise */}
          <motion.div
            className="p-8"
            initial={{ opacity: 0, y: 15 }}
            animate={inView ? { opacity: 1, y: 0 } : {}}
            transition={{ ...ease, delay: 0.15 }}
          >
            <span
              className="text-xs text-[#999999] uppercase tracking-wider"
              style={font.mono}
            >
              Enterprise
            </span>
            <div
              className="text-4xl font-bold text-[#0a0a0a] mt-2"
              style={font.display}
            >
              Custom
            </div>
            <p className="text-sm text-[#666666] mt-2 leading-relaxed" style={font.body}>
              Dedicated support, SLA, custom integrations, on-prem deployment,
              and training.
            </p>
            <a
              href="#"
              className="mt-5 block text-center px-4 py-2 text-sm font-semibold rounded-lg border border-[#e5e5e5] text-[#0a0a0a] hover:border-[#d4d4d4] transition-colors"
              style={font.display}
            >
              Contact Sales
            </a>
          </motion.div>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// CTA (Dark Aurora)
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
      style={{ background: AURORA }}
    >
      <div className="max-w-2xl mx-auto text-center">
        <motion.h2
          className="text-4xl md:text-5xl font-bold text-[#fafafa] tracking-tight"
          style={font.display}
          initial={{ opacity: 0, y: 20 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={ease}
        >
          Start shipping from your terminal
        </motion.h2>

        <motion.div
          className="mt-8"
          initial={{ opacity: 0, y: 15 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ ...ease, delay: 0.15 }}
        >
          <button
            onClick={handleCopy}
            className="w-full max-w-lg mx-auto flex items-center justify-between px-5 py-3.5 rounded-xl border border-[#262626] bg-[#111111] hover:border-[#7c3aed]/40 transition-colors group"
          >
            <span className="text-sm text-[#a78bfa]" style={font.mono}>
              $ {installCmd}
            </span>
            {copied ? (
              <Check size={16} className="text-[#4ade80] shrink-0 ml-3" />
            ) : (
              <Copy
                size={16}
                className="text-[#666666] group-hover:text-[#999999] transition-colors shrink-0 ml-3"
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
              Get Started <ArrowRight size={16} />
            </a>
            <a
              href="#"
              className="px-6 py-2.5 rounded-lg border border-[#404040] text-[#fafafa] text-sm font-semibold hover:border-[#525252] transition-colors inline-flex items-center gap-2"
              style={font.display}
            >
              <Github size={16} /> GitHub
            </a>
          </div>

          <span className="text-xs text-[#666666]" style={font.mono}>
            Free &middot; Open Source &middot; Self-Hosted
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
      title: "Community",
      links: ["GitHub", "Discord", "Blog", "Contributing"],
    },
    {
      title: "Company",
      links: ["About", "Pricing", "Security", "License"],
    },
  ];

  return (
    <footer className="px-5 py-12 bg-[#0a0a0a] border-t border-[#262626]">
      <div className="max-w-7xl mx-auto">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
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
              className="text-sm text-[#666666] leading-relaxed"
              style={font.body}
            >
              Self-hosted PaaS for developers who ship from the terminal.
            </p>
            <div className="flex items-center gap-3 mt-4">
              <a href="#" className="text-[#666666] hover:text-[#999999] transition-colors">
                <Github size={16} />
              </a>
              <a href="#" className="text-[#666666] hover:text-[#999999] transition-colors">
                <Twitter size={16} />
              </a>
            </div>
            <div className="flex items-center gap-1 mt-4">
              {VARIANT_LINKS.map((v) => (
                <Link
                  key={v.to}
                  to={v.to}
                  className={`w-6 h-6 flex items-center justify-center text-xs rounded transition-colors ${
                    v.to === "/7"
                      ? "bg-[#7c3aed]/20 text-[#a78bfa]"
                      : "text-[#666666] hover:text-[#999999]"
                  }`}
                  style={font.mono}
                >
                  {v.label}
                </Link>
              ))}
            </div>
          </div>

          {columns.map((col) => (
            <div key={col.title}>
              <h5
                className="text-xs text-[#666666] uppercase tracking-wider mb-3"
                style={font.mono}
              >
                {col.title}
              </h5>
              <div className="flex flex-col gap-2">
                {col.links.map((link) => (
                  <a
                    key={link}
                    href="#"
                    className="text-sm text-[#999999] hover:text-[#fafafa] transition-colors"
                    style={{ ...font.body, fontWeight: 400 }}
                  >
                    {link}
                  </a>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-10 pt-6 border-t border-[#262626] flex flex-wrap items-center justify-between gap-4">
          <span className="text-xs text-[#666666]" style={font.mono}>
            &copy; 2026 otterdeploy
          </span>
          <span className="text-xs text-[#666666]" style={font.mono}>
            built for developers who love the terminal
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
    <div className="bg-white text-[#0a0a0a] min-h-screen" style={font.body}>
      <Nav />
      <Hero />
      <BuiltByDevelopers />
      <DarkTerminalSection />
      <BentoGrid />
      <FeatureTabs />
      <StatsRow />
      <TwoColumns />
      <PricingGrid />
      <CTA />
      <Footer />
    </div>
  );
}
