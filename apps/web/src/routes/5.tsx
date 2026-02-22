import { createFileRoute, Link } from "@tanstack/react-router";
import { motion, useInView } from "motion/react";
import { useEffect, useRef, useState } from "react";
import {
  FileCode,
  GitBranch,
  Layers,
  Activity,
  Lock,
  Shield,
  Github,
  ArrowRight,
  Copy,
  Check,
  Terminal,
  Rocket,
  Eye,
  Maximize,
  Twitter,
} from "lucide-react";

export const Route = createFileRoute("/5")({
  component: RouteComponent,
});

// ---------------------------------------------------------------------------
// Font Loader
// ---------------------------------------------------------------------------

function useFonts() {
  useEffect(() => {
    const id = "amber-grid-fonts";
    if (document.getElementById(id)) return;
    const link = document.createElement("link");
    link.id = id;
    link.rel = "stylesheet";
    link.href =
      "https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap";
    document.head.appendChild(link);
  }, []);
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VARIANT_LINKS = [
  { label: "1", to: "/1" },
  { label: "2", to: "/2" },
  { label: "3", to: "/3" },
  { label: "4", to: "/4" },
  { label: "5", to: "/5" },
];

const DEPLOY_LINES = [
  { text: "$ otter deploy --env production", type: "command" as const, delay: 0 },
  { text: "", type: "blank" as const, delay: 0.3 },
  { text: "\u25b8 Building services...", type: "header" as const, delay: 0.5 },
  { text: "  \u2713 web        Built in 8s", type: "success" as const, delay: 0.9 },
  { text: "  \u2713 api        Built in 5s", type: "success" as const, delay: 1.2 },
  { text: "  \u2713 worker     Built in 3s", type: "success" as const, delay: 1.5 },
  { text: "", type: "blank" as const, delay: 1.7 },
  { text: "\u25b8 Deploying...", type: "header" as const, delay: 1.9 },
  { text: "  \u2713 web        \u2192 myapp.com", type: "success" as const, delay: 2.2 },
  { text: "  \u2713 api        \u2192 api.myapp.com", type: "success" as const, delay: 2.5 },
  { text: "  \u2713 postgres   Connected", type: "success" as const, delay: 2.8 },
  { text: "  \u2713 redis      Connected", type: "success" as const, delay: 3.0 },
  { text: "", type: "blank" as const, delay: 3.2 },
  { text: "\u2713 Deploy complete! (18s)", type: "final" as const, delay: 3.4 },
];

const TAB_DATA = {
  config: {
    label: "OTTER CONFIG",
    heading: "Declarative infrastructure",
    bullets: [
      "Single file for entire stack",
      "Environment variables",
      "Volume mounts",
      "Resource linking",
    ],
    code: `# otterdeploy.yml
name: myapp

services:
  web:
    build: ./app
    port: 3000
    replicas: 2
  api:
    build: ./server
    port: 8080
    env:
      - DATABASE_URL
      - REDIS_URL

databases:
  postgres:
    version: "16"
  redis:
    version: "7"

volumes:
  uploads:
    size: 10Gi
    mount: /data/uploads`,
  },
  deploy: {
    label: "OTTER DEPLOY",
    heading: "Push to production",
    bullets: [
      "Automatic builds",
      "Zero-downtime deploys",
      "Rollback support",
      "Branch previews",
    ],
    code: `$ otter deploy --env production

\u25b8 Building services...
  \u2713 web        Built in 8s
  \u2713 api        Built in 5s
  \u2713 worker     Built in 3s

\u25b8 Deploying...
  \u2713 web        \u2192 myapp.com
  \u2713 api        \u2192 api.myapp.com
  \u2713 postgres   Connected
  \u2713 redis      Connected

\u2713 Deploy complete! (18s)`,
  },
  monitor: {
    label: "OTTER MONITOR",
    heading: "Real-time observability",
    bullets: [
      "Live log streaming",
      "Health check dashboards",
      "Resource usage metrics",
      "Alert configuration",
    ],
    code: `$ otter logs --tail --service api

[12:04:01] 200 GET  /health      2ms
[12:04:03] 200 POST /api/users  18ms
[12:04:05] 200 GET  /api/items   4ms
[12:04:06] 201 POST /api/deploy 42ms

\u25b8 cpu: 23%  mem: 412MB  req/s: 1.2k
\u25b8 uptime: 99.99%  p99: 48ms`,
  },
  scale: {
    label: "OTTER SCALE",
    heading: "Scale with confidence",
    bullets: [
      "Horizontal auto-scaling",
      "Load balancer config",
      "Multi-region support",
      "Resource limits",
    ],
    code: `$ otter scale web --replicas 4

\u25b8 Scaling web: 2 \u2192 4 replicas
  \u2713 replica-3   Running
  \u2713 replica-4   Running
  \u2713 Load balancer updated

\u2713 web scaled to 4 replicas
  avg cpu: 34% \u2192 18%
  avg mem: 380MB \u2192 210MB`,
  },
};

type TabKey = keyof typeof TAB_DATA;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const font = {
  display: { fontFamily: "'DM Sans', sans-serif" },
  body: { fontFamily: "'DM Sans', sans-serif" },
  mono: { fontFamily: "'IBM Plex Mono', monospace" },
};

const ease = { type: "tween" as const, ease: "easeOut" as const, duration: 0.4 };

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
      style={{ background: dark ? "#111111" : "#fafaf9" }}
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
          className={`text-xs ml-2 ${dark ? "text-[#737373]" : "text-[#a3a3a3]"}`}
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
            className="text-[#171717] text-lg font-bold tracking-tight"
            style={font.display}
          >
            otterdeploy
          </span>
          <span className="w-1.5 h-1.5 rounded-full bg-[#f59e0b] inline-block mb-2" />
        </div>

        <div className="hidden md:flex items-center gap-6">
          <a
            href="#"
            className="text-sm text-[#737373] hover:text-[#171717] transition-colors"
            style={{ ...font.body, fontWeight: 500 }}
          >
            Documentation
          </a>
        </div>

        <div className="flex items-center gap-2">
          <div className="hidden sm:flex items-center gap-1 mr-2">
            {VARIANT_LINKS.map((v) => (
              <Link
                key={v.to}
                to={v.to}
                className={`w-7 h-7 flex items-center justify-center text-xs rounded transition-colors ${
                  v.to === "/5"
                    ? "bg-[#f59e0b]/15 text-[#d97706] font-medium"
                    : "text-[#a3a3a3] hover:text-[#737373]"
                }`}
                style={font.mono}
              >
                {v.label}
              </Link>
            ))}
          </div>
          <a
            href="#cta"
            className="px-4 py-1.5 text-sm font-semibold rounded-lg bg-[#f59e0b] text-white hover:bg-[#d97706] transition-colors"
            style={font.display}
          >
            Deploy Now
          </a>
        </div>
      </div>
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Isometric Grid (Hero Visual)
// ---------------------------------------------------------------------------

const GRID_CELLS = [
  { label: "web", r: 0, c: 0 },
  { label: "api", r: 0, c: 1 },
  { label: "worker", r: 0, c: 2 },
  { label: "db", r: 1, c: 0 },
  { label: "cache", r: 1, c: 1 },
  { label: "volume", r: 1, c: 2 },
  { label: "secrets", r: 2, c: 0 },
  { label: "logs", r: 2, c: 1 },
  { label: "config", r: 2, c: 2 },
];

const SATELLITE_NODES = [
  { label: ".DOCKER", x: -100, y: -40 },
  { label: ".POSTGRES", x: 230, y: -50 },
  { label: ".REDIS", x: 250, y: 120 },
  { label: ".NODE", x: -110, y: 130 },
];

function IsometricDiagram() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-40px" });

  return (
    <div ref={ref} className="flex justify-center mt-20">
      <div className="relative" style={{ width: 500, height: 380 }}>
        {/* Isometric grid container */}
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
                className="w-[76px] h-[76px] rounded-lg border border-[#e5e5e5] bg-white flex items-center justify-center hover:border-[#f59e0b]/50 transition-colors"
                style={font.mono}
                initial={{ opacity: 0, scale: 0.5 }}
                animate={inView ? { opacity: 1, scale: 1 } : {}}
                transition={{ ...ease, delay: 0.08 * i, duration: 0.5 }}
              >
                <span className="text-[10px] text-[#737373] font-medium">
                  {cell.label}
                </span>
              </motion.div>
            ))}
          </div>
        </div>

        {/* Satellite nodes */}
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
            <span className="text-[10px] text-[#d97706] font-medium">
              {node.label}
            </span>
          </motion.div>
        ))}

        {/* Connecting lines (SVG) */}
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

  return (
    <section ref={ref} className="pt-28 pb-16 px-5 bg-white">
      <div className="max-w-5xl mx-auto text-center">
        <motion.h1
          className="text-5xl md:text-7xl font-bold text-[#171717] leading-[1.1] tracking-tight"
          style={font.display}
          initial={{ opacity: 0, y: 20 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ ...ease, delay: 0.1 }}
        >
          The Unified Platform
          <br />
          for Self-Hosted{" "}
          <span className="text-[#f59e0b]">Infrastructure</span>
        </motion.h1>

        <motion.p
          className="mt-6 text-lg text-[#737373] max-w-2xl mx-auto leading-relaxed"
          style={{ ...font.body, fontWeight: 400 }}
          initial={{ opacity: 0, y: 15 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ ...ease, delay: 0.25 }}
        >
          define, build, deploy, monitor & scale — a single platform, built for
          speed and sanity
        </motion.p>

        <motion.div
          className="mt-8 flex items-center justify-center gap-3"
          initial={{ opacity: 0, y: 10 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ ...ease, delay: 0.4 }}
        >
          <a
            href="#cta"
            className="px-6 py-2.5 text-sm font-semibold rounded-lg bg-[#f59e0b] text-[#171717] hover:bg-[#d97706] transition-colors inline-flex items-center gap-2"
            style={font.display}
          >
            Deploy now <ArrowRight size={16} />
          </a>
          <a
            href="#features"
            className="px-6 py-2.5 text-sm font-semibold rounded-lg border border-[#e5e5e5] text-[#171717] hover:border-[#d4d4d4] transition-colors"
            style={font.display}
          >
            Learn more
          </a>
        </motion.div>

        <IsometricDiagram />
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Everything You Need
// ---------------------------------------------------------------------------

function EverythingSection() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });

  return (
    <section
      ref={ref}
      className="py-24 px-5 bg-[#fafaf9] border-t border-[#e5e5e5]"
    >
      <div className="max-w-7xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={ease}
        >
          <h2
            className="text-4xl font-bold text-[#171717] tracking-tight"
            style={font.display}
          >
            Everything you need to ship
          </h2>
          <p
            className="mt-2 text-xl font-semibold text-[#171717]"
            style={font.display}
          >
            — without the infrastructure headaches.
          </p>
          <p
            className="mt-4 text-base text-[#737373] max-w-xl leading-relaxed"
            style={font.body}
          >
            Otterdeploy gives you a complete self-hosted PaaS with declarative
            configs, git-driven deploys, real-time monitoring, secrets
            management, and multi-tenant RBAC — all from a single YAML file.
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
      style={{
        background: `radial-gradient(ellipse at 50% 0%, rgba(245,158,11,0.2) 0%, transparent 60%),
                     radial-gradient(ellipse at 60% 40%, rgba(251,191,36,0.1) 0%, transparent 50%),
                     #171717`,
      }}
    >
      <div className="max-w-3xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={ease}
        >
          <TerminalWindow title="Terminal — otterdeploy" className="shadow-none">
            <div className="text-sm leading-relaxed min-h-[300px]">
              {DEPLOY_LINES.slice(0, visibleLines).map((line, i) => (
                <div key={i} className="whitespace-pre">
                  {line.type === "command" && (
                    <span className="text-[#fafafa]">{line.text}</span>
                  )}
                  {line.type === "blank" && <br />}
                  {line.type === "header" && (
                    <span className="text-[#a3a3a3]">{line.text}</span>
                  )}
                  {line.type === "success" && (
                    <span>
                      <span className="text-[#4ade80]">
                        {line.text.slice(0, 3)}
                      </span>
                      <span className="text-[#fafafa]">
                        {line.text.slice(3).split("\u2192")[0]}
                      </span>
                      {line.text.includes("\u2192") && (
                        <>
                          <span className="text-[#737373]">{"\u2192 "}</span>
                          <span className="text-[#fbbf24]">
                            {line.text.split("\u2192")[1].trim()}
                          </span>
                        </>
                      )}
                    </span>
                  )}
                  {line.type === "final" && (
                    <span className="text-[#4ade80] font-medium">
                      {line.text}
                    </span>
                  )}
                </div>
              ))}
              {visibleLines < DEPLOY_LINES.length && inView && (
                <span className="inline-block w-2 h-4 bg-[#fbbf24] animate-pulse" />
              )}
            </div>
          </TerminalWindow>
        </motion.div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Bento Grid Features
// ---------------------------------------------------------------------------

function BentoGrid() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });

  const yamlSnippet = `services:
  web:
    build: ./app
    port: 3000
  api:
    build: ./server
    port: 8080`;

  const gitSnippet = `$ git push origin main
\u25b8 deploy triggered \u2192 #1248
\u2713 production live (18s)`;

  return (
    <section
      id="features"
      ref={ref}
      className="py-24 px-5 bg-white border-t border-[#e5e5e5]"
    >
      <div className="max-w-5xl mx-auto">
        <motion.h2
          className="text-4xl font-bold text-[#171717] tracking-tight mb-10"
          style={font.display}
          initial={{ opacity: 0, y: 15 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={ease}
        >
          Built for developers
        </motion.h2>

        {/* Bento grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {/* Config as Code — 2 cols */}
          <motion.div
            className="md:col-span-2 rounded-xl border border-[#e5e5e5] bg-white p-6 hover:border-[#f59e0b]/30 transition-colors"
            initial={{ opacity: 0, scale: 0.97 }}
            animate={inView ? { opacity: 1, scale: 1 } : {}}
            transition={{ ...ease, delay: 0.05 }}
          >
            <div className="flex items-center gap-2 mb-2">
              <FileCode size={18} className="text-[#f59e0b]" />
              <h3
                className="text-base font-semibold text-[#171717]"
                style={font.display}
              >
                Config as Code
              </h3>
            </div>
            <p
              className="text-sm text-[#737373] mb-4 leading-relaxed"
              style={font.body}
            >
              Define your entire infrastructure in a single YAML file.
              Version-controlled, repeatable, auditable.
            </p>
            <div
              className="rounded-lg border border-[#e5e5e5] bg-[#fafaf9] p-4 text-xs leading-relaxed"
              style={font.mono}
            >
              {yamlSnippet.split("\n").map((line, i) => (
                <div key={i}>
                  {line.endsWith(":") || line.trimStart().startsWith("build") || line.trimStart().startsWith("port") ? (
                    <span>
                      <span className="text-[#d97706]">
                        {line.split(":")[0]}:
                      </span>
                      <span className="text-[#171717]">
                        {line.includes(":") ? line.slice(line.indexOf(":") + 1) : ""}
                      </span>
                    </span>
                  ) : (
                    <span className="text-[#171717]">{line}</span>
                  )}
                </div>
              ))}
            </div>
          </motion.div>

          {/* Git Deploys — 1x1 */}
          <motion.div
            className="rounded-xl border border-[#e5e5e5] bg-white p-6 hover:border-[#f59e0b]/30 transition-colors"
            initial={{ opacity: 0, scale: 0.97 }}
            animate={inView ? { opacity: 1, scale: 1 } : {}}
            transition={{ ...ease, delay: 0.1 }}
          >
            <div className="flex items-center gap-2 mb-2">
              <GitBranch size={18} className="text-[#f59e0b]" />
              <h3
                className="text-base font-semibold text-[#171717]"
                style={font.display}
              >
                Git Deploys
              </h3>
            </div>
            <p
              className="text-sm text-[#737373] mb-4 leading-relaxed"
              style={font.body}
            >
              Push to deploy. Every commit triggers a build pipeline
              automatically.
            </p>
            <div
              className="rounded-lg bg-[#171717] p-3 text-[11px] leading-relaxed text-[#4ade80]"
              style={font.mono}
            >
              {gitSnippet.split("\n").map((line, i) => (
                <div key={i} className="whitespace-pre">
                  {line}
                </div>
              ))}
            </div>
          </motion.div>

          {/* Multi-Env — 1x1 */}
          <motion.div
            className="rounded-xl border border-[#e5e5e5] bg-white p-6 hover:border-[#f59e0b]/30 transition-colors"
            initial={{ opacity: 0, scale: 0.97 }}
            animate={inView ? { opacity: 1, scale: 1 } : {}}
            transition={{ ...ease, delay: 0.15 }}
          >
            <div className="flex items-center gap-2 mb-2">
              <Layers size={18} className="text-[#f59e0b]" />
              <h3
                className="text-base font-semibold text-[#171717]"
                style={font.display}
              >
                Multi-Environment
              </h3>
            </div>
            <p
              className="text-sm text-[#737373] mb-4 leading-relaxed"
              style={font.body}
            >
              Staging inherits base, production inherits staging. Override only
              what differs.
            </p>
            <div className="flex flex-wrap gap-2">
              <span className="px-3 py-1 rounded-md text-xs font-medium bg-green-50 text-green-700 border border-green-200">
                production
              </span>
              <span className="px-3 py-1 rounded-md text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200">
                staging
              </span>
              <span className="px-3 py-1 rounded-md text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200">
                development
              </span>
            </div>
          </motion.div>

          {/* Dashboard — 2 cols */}
          <motion.div
            className="md:col-span-2 rounded-xl border border-[#e5e5e5] bg-white p-6 hover:border-[#f59e0b]/30 transition-colors"
            initial={{ opacity: 0, scale: 0.97 }}
            animate={inView ? { opacity: 1, scale: 1 } : {}}
            transition={{ ...ease, delay: 0.2 }}
          >
            <div className="flex items-center gap-2 mb-2">
              <Activity size={18} className="text-[#f59e0b]" />
              <h3
                className="text-base font-semibold text-[#171717]"
                style={font.display}
              >
                Real-time Dashboard
              </h3>
            </div>
            <p
              className="text-sm text-[#737373] mb-4 leading-relaxed"
              style={font.body}
            >
              Monitor your entire stack from a single pane. Live logs, metrics,
              health checks, and deployment status.
            </p>
            {/* Mini architecture diagram */}
            <div className="flex items-center gap-3 flex-wrap">
              {["web :3000", "api :8080", "postgres", "redis"].map((s, i) => (
                <div key={s} className="flex items-center gap-2">
                  <div className="px-3 py-2 rounded-md border border-[#e5e5e5] bg-[#fafaf9] text-xs" style={font.mono}>
                    <span className="text-[#171717]">{s}</span>
                  </div>
                  {i < 3 && (
                    <div className="w-6 h-px bg-[#e5e5e5]" />
                  )}
                </div>
              ))}
              <span className="ml-2 text-xs text-[#4ade80] flex items-center gap-1" style={font.mono}>
                <span className="w-1.5 h-1.5 rounded-full bg-[#4ade80]" />
                all healthy
              </span>
            </div>
          </motion.div>

          {/* Secrets — 1x1 */}
          <motion.div
            className="rounded-xl border border-[#e5e5e5] bg-white p-6 hover:border-[#f59e0b]/30 transition-colors"
            initial={{ opacity: 0, scale: 0.97 }}
            animate={inView ? { opacity: 1, scale: 1 } : {}}
            transition={{ ...ease, delay: 0.25 }}
          >
            <div className="flex items-center gap-2 mb-2">
              <Lock size={18} className="text-[#f59e0b]" />
              <h3
                className="text-base font-semibold text-[#171717]"
                style={font.display}
              >
                Secrets Management
              </h3>
            </div>
            <p
              className="text-sm text-[#737373] mb-4 leading-relaxed"
              style={font.body}
            >
              Encrypted secrets, scoped per environment. Rotate without
              restarts or downtime.
            </p>
            <div className="flex justify-center py-2">
              <Lock size={36} className="text-[#f59e0b]/40" />
            </div>
          </motion.div>

          {/* RBAC — 1x1 */}
          <motion.div
            className="rounded-xl border border-[#e5e5e5] bg-white p-6 hover:border-[#f59e0b]/30 transition-colors"
            initial={{ opacity: 0, scale: 0.97 }}
            animate={inView ? { opacity: 1, scale: 1 } : {}}
            transition={{ ...ease, delay: 0.3 }}
          >
            <div className="flex items-center gap-2 mb-2">
              <Shield size={18} className="text-[#f59e0b]" />
              <h3
                className="text-base font-semibold text-[#171717]"
                style={font.display}
              >
                RBAC & Teams
              </h3>
            </div>
            <p
              className="text-sm text-[#737373] leading-relaxed"
              style={font.body}
            >
              Multi-tenancy with granular role-based access control. Teams,
              permissions, and audit trails built in.
            </p>
          </motion.div>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Feature Tabs (Dark Section)
// ---------------------------------------------------------------------------

function FeatureTabs() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });
  const [activeTab, setActiveTab] = useState<TabKey>("config");

  const tabIcons: Record<TabKey, React.ReactNode> = {
    config: <FileCode size={16} />,
    deploy: <Rocket size={16} />,
    monitor: <Eye size={16} />,
    scale: <Maximize size={16} />,
  };

  const data = TAB_DATA[activeTab];

  return (
    <section
      ref={ref}
      className="py-24 px-5 bg-[#171717]"
    >
      <div className="max-w-6xl mx-auto">
        <motion.h2
          className="text-3xl md:text-4xl font-bold text-[#fafafa] text-center tracking-tight mb-10"
          style={font.display}
          initial={{ opacity: 0, y: 15 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={ease}
        >
          Everything you need in one platform
        </motion.h2>

        {/* Tab bar */}
        <motion.div
          className="flex items-center justify-center gap-1 mb-10"
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
                  ? "bg-[#f59e0b]/15 text-[#fbbf24]"
                  : "text-[#a3a3a3] hover:text-[#fafafa]"
              }`}
              style={{ ...font.body, fontWeight: 500 }}
            >
              {tabIcons[key]}
              {key}
            </button>
          ))}
        </motion.div>

        {/* Tab content */}
        <motion.div
          key={activeTab}
          className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...ease, duration: 0.3 }}
        >
          {/* Left: text */}
          <div className="py-2">
            <span
              className="text-xs text-[#f59e0b] uppercase tracking-wider mb-3 block"
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
                    className="text-sm text-[#a3a3a3]"
                    style={{ ...font.body, fontWeight: 400 }}
                  >
                    {b}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          {/* Right: terminal */}
          <TerminalWindow title={`${activeTab}.sh`}>
            <div className="text-xs leading-relaxed whitespace-pre">
              {data.code.split("\n").map((line, i) => {
                if (line.startsWith("#")) {
                  return (
                    <div key={i} className="text-[#737373]">{line}</div>
                  );
                }
                if (line.startsWith("$") || line.startsWith("\u25b8")) {
                  return (
                    <div key={i} className="text-[#a3a3a3]">{line}</div>
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
                          <span className="text-[#737373]">{"\u2192 "}</span>
                          <span className="text-[#fbbf24]">
                            {line.split("\u2192")[1].trim()}
                          </span>
                        </>
                      )}
                    </div>
                  );
                }
                if (line.trim().endsWith(":") || line.includes(":")) {
                  const colonIdx = line.indexOf(":");
                  return (
                    <div key={i}>
                      <span className="text-[#fbbf24]">
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
  { value: "4,200+", label: "deploys" },
  { value: "99.9%", label: "uptime" },
  { value: "18s", label: "avg build" },
  { value: "Open Source", label: "forever" },
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
              className="text-4xl md:text-5xl font-bold text-[#f59e0b] mb-1"
              style={font.display}
            >
              {stat.value}
            </div>
            <div
              className="text-sm text-[#737373]"
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
// Two-Column Section
// ---------------------------------------------------------------------------

function TwoColumns() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });

  const productBullets = [
    "Declarative config — no clicking through dashboards",
    "Git-driven workflows for every environment",
    "Instant rollbacks with zero-downtime deploys",
    "Built-in log streaming and metrics",
    "Automatic TLS and domain management",
  ];

  const securityBullets = [
    "Encrypted secrets with per-environment scoping",
    "Role-based access control with audit trails",
    "Network isolation between services",
    "Automatic security patching for base images",
    "SOC 2 and GDPR compliance-ready",
  ];

  return (
    <section
      ref={ref}
      className="py-24 px-5 bg-[#fafaf9] border-t border-[#e5e5e5]"
    >
      <div className="max-w-5xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-16">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ ...ease, delay: 0.05 }}
        >
          <h3
            className="text-2xl font-bold text-[#171717] mb-6"
            style={font.display}
          >
            Focus on product, not ops
          </h3>
          <ul className="flex flex-col gap-3">
            {productBullets.map((b) => (
              <li key={b} className="flex items-start gap-3">
                <span className="w-1.5 h-1.5 rounded-full bg-[#f59e0b] mt-2 shrink-0" />
                <span
                  className="text-sm text-[#737373] leading-relaxed"
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
            className="text-2xl font-bold text-[#171717] mb-6"
            style={font.display}
          >
            Security built in
          </h3>
          <ul className="flex flex-col gap-3">
            {securityBullets.map((b) => (
              <li key={b} className="flex items-start gap-3">
                <Check size={16} className="text-[#f59e0b] mt-0.5 shrink-0" />
                <span
                  className="text-sm text-[#737373] leading-relaxed"
                  style={font.body}
                >
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
        <div className="grid grid-cols-1 md:grid-cols-2 border border-[#e5e5e5] rounded-xl overflow-hidden">
          {/* Info cell */}
          <motion.div
            className="p-8 border-b md:border-b-0 md:border-r border-[#e5e5e5]"
            initial={{ opacity: 0, y: 15 }}
            animate={inView ? { opacity: 1, y: 0 } : {}}
            transition={{ ...ease, delay: 0.05 }}
          >
            <h2
              className="text-3xl font-bold text-[#171717] mb-3"
              style={font.display}
            >
              Pricing
            </h2>
            <p
              className="text-sm text-[#737373] leading-relaxed"
              style={font.body}
            >
              Self-hosted and open source at its core. Pay only for the support
              and features your team needs.
            </p>
          </motion.div>

          {/* Community */}
          <motion.div
            className="p-8 border-b md:border-b-0 border-[#e5e5e5]"
            initial={{ opacity: 0, y: 15 }}
            animate={inView ? { opacity: 1, y: 0 } : {}}
            transition={{ ...ease, delay: 0.1 }}
          >
            <span
              className="text-xs text-[#a3a3a3] uppercase tracking-wider"
              style={font.mono}
            >
              Community
            </span>
            <div
              className="text-4xl font-bold text-[#171717] mt-2"
              style={font.display}
            >
              Free
            </div>
            <p className="text-sm text-[#737373] mt-2" style={font.body}>
              All core features, unlimited deploys, community support.
            </p>
          </motion.div>

          {/* Pro */}
          <motion.div
            className="p-8 border-t md:border-t border-r border-[#e5e5e5]"
            initial={{ opacity: 0, y: 15 }}
            animate={inView ? { opacity: 1, y: 0 } : {}}
            transition={{ ...ease, delay: 0.15 }}
          >
            <span
              className="text-xs text-[#f59e0b] uppercase tracking-wider font-medium"
              style={font.mono}
            >
              Pro
            </span>
            <div className="mt-2">
              <span
                className="text-4xl font-bold text-[#171717]"
                style={font.display}
              >
                $29
              </span>
              <span className="text-sm text-[#a3a3a3] ml-1">/mo</span>
            </div>
            <p className="text-sm text-[#737373] mt-2" style={font.body}>
              Priority support, advanced RBAC, SSO, audit logs.
            </p>
          </motion.div>

          {/* Enterprise */}
          <motion.div
            className="p-8 border-t border-[#e5e5e5]"
            initial={{ opacity: 0, y: 15 }}
            animate={inView ? { opacity: 1, y: 0 } : {}}
            transition={{ ...ease, delay: 0.2 }}
          >
            <span
              className="text-xs text-[#a3a3a3] uppercase tracking-wider"
              style={font.mono}
            >
              Enterprise
            </span>
            <div
              className="text-4xl font-bold text-[#171717] mt-2"
              style={font.display}
            >
              Custom
            </div>
            <p className="text-sm text-[#737373] mt-2" style={font.body}>
              Dedicated support, SLA, custom integrations, on-prem.
            </p>
          </motion.div>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// CTA (Dark with amber aurora)
// ---------------------------------------------------------------------------

function CTA() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-60px" });
  const [copied, setCopied] = useState(false);

  const installCmd = "curl -fsSL https://get.otterdeploy.sh | sh";

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
        background: `radial-gradient(ellipse at 50% 20%, rgba(245,158,11,0.25) 0%, transparent 60%),
                     radial-gradient(ellipse at 30% 80%, rgba(251,191,36,0.1) 0%, transparent 50%),
                     #171717`,
      }}
    >
      <div className="max-w-2xl mx-auto text-center">
        <motion.h2
          className="text-4xl md:text-5xl font-bold text-[#fafafa] tracking-tight"
          style={font.display}
          initial={{ opacity: 0, y: 20 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={ease}
        >
          Build something great
        </motion.h2>

        <motion.div
          className="mt-8"
          initial={{ opacity: 0, y: 15 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ ...ease, delay: 0.15 }}
        >
          <button
            onClick={handleCopy}
            className="w-full max-w-lg mx-auto flex items-center justify-between px-5 py-3.5 rounded-xl border border-[#262626] bg-[#111111] hover:border-[#f59e0b]/40 transition-colors group"
          >
            <span className="text-sm text-[#fbbf24]" style={font.mono}>
              $ {installCmd}
            </span>
            {copied ? (
              <Check size={16} className="text-[#4ade80] shrink-0 ml-3" />
            ) : (
              <Copy
                size={16}
                className="text-[#737373] group-hover:text-[#a3a3a3] transition-colors shrink-0 ml-3"
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
              className="px-6 py-2.5 rounded-lg bg-[#f59e0b] text-[#171717] text-sm font-semibold hover:bg-[#d97706] transition-colors inline-flex items-center gap-2"
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

          <span className="text-xs text-[#737373]" style={font.mono}>
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
    <footer className="px-5 py-12 bg-[#171717] border-t border-[#262626]">
      <div className="max-w-7xl mx-auto">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
          {/* Brand */}
          <div>
            <div className="flex items-center gap-1 mb-3">
              <span
                className="text-[#fafafa] font-bold tracking-tight"
                style={font.display}
              >
                otterdeploy
              </span>
              <span className="w-1.5 h-1.5 rounded-full bg-[#f59e0b] inline-block mb-2" />
            </div>
            <p
              className="text-sm text-[#737373] leading-relaxed"
              style={font.body}
            >
              Self-hosted PaaS for teams that ship.
            </p>
            <div className="flex items-center gap-3 mt-4">
              <a href="#" className="text-[#737373] hover:text-[#a3a3a3] transition-colors">
                <Github size={16} />
              </a>
              <a href="#" className="text-[#737373] hover:text-[#a3a3a3] transition-colors">
                <Twitter size={16} />
              </a>
            </div>
            <div className="flex items-center gap-1 mt-4">
              {VARIANT_LINKS.map((v) => (
                <Link
                  key={v.to}
                  to={v.to}
                  className={`w-6 h-6 flex items-center justify-center text-xs rounded transition-colors ${
                    v.to === "/5"
                      ? "bg-[#f59e0b]/20 text-[#fbbf24]"
                      : "text-[#737373] hover:text-[#a3a3a3]"
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
                className="text-xs text-[#737373] uppercase tracking-wider mb-3"
                style={font.mono}
              >
                {col.title}
              </h5>
              <div className="flex flex-col gap-2">
                {col.links.map((link) => (
                  <a
                    key={link}
                    href="#"
                    className="text-sm text-[#a3a3a3] hover:text-[#fafafa] transition-colors"
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
        <div className="mt-10 pt-6 border-t border-[#262626] flex flex-wrap items-center justify-between gap-4">
          <span className="text-xs text-[#737373]" style={font.mono}>
            &copy; 2026 otterdeploy
          </span>
          <span className="text-xs text-[#737373]" style={font.mono}>
            built for developers, by developers
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
    <div className="bg-white text-[#171717] min-h-screen" style={font.body}>
      <Nav />
      <Hero />
      <EverythingSection />
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
