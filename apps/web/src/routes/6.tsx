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

export const Route = createFileRoute("/6")({
  component: RouteComponent,
});

// ---------------------------------------------------------------------------
// Font Loader
// ---------------------------------------------------------------------------

function useFonts() {
  useEffect(() => {
    const id = "otterdeploy-v6-fonts";
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
  { text: "$ otter deploy --env production", type: "command" as const },
  { text: "", type: "blank" as const },
  { text: "otterdeploy v2.4.0 ready in 12s", type: "brand" as const },
  { text: "", type: "blank" as const },
  { text: "\u2192 Building services...", type: "header" as const },
  { text: "  \u2713 web        Built in 8s", type: "success" as const },
  { text: "  \u2713 api        Built in 5s", type: "success" as const },
  { text: "  \u2713 worker     Built in 3s", type: "success" as const },
  { text: "", type: "blank" as const },
  { text: "\u2192 Deploying to production...", type: "header" as const },
  { text: "  \u2713 web        \u2192 https://myapp.com", type: "success" as const },
  { text: "  \u2713 api        \u2192 https://api.myapp.com", type: "success" as const },
  { text: "  \u2713 postgres   Connected", type: "success" as const },
  { text: "  \u2713 redis      Connected", type: "success" as const },
  { text: "", type: "blank" as const },
  { text: "Deploy complete! All services healthy.", type: "final" as const },
];

const TAB_DATA = {
  config: {
    label: "OTTER CONFIG",
    heading: "Declarative infrastructure",
    bullets: [
      "Single file for entire stack",
      "Environment variable injection",
      "Volume mounts and persistence",
      "Resource linking and discovery",
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
      "Automatic builds on git push",
      "Zero-downtime rolling deploys",
      "Instant rollback support",
      "Branch preview environments",
    ],
    code: `$ otter deploy --env production

\u2192 Building services...
  \u2713 web        Built in 8s
  \u2713 api        Built in 5s
  \u2713 worker     Built in 3s

\u2192 Deploying...
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
      "Load balancer configuration",
      "Multi-region support",
      "Resource limits and quotas",
    ],
    code: `$ otter scale web --replicas 4

\u2192 Scaling web: 2 \u2192 4 replicas
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
  display: { fontFamily: "'Plus Jakarta Sans', sans-serif" },
  body: { fontFamily: "'Plus Jakarta Sans', sans-serif" },
  mono: { fontFamily: "'JetBrains Mono', monospace" },
};

const ease: { type: "tween"; ease: number[]; duration: number } = {
  type: "tween",
  ease: [0.25, 0.46, 0.45, 0.94],
  duration: 0.6,
};

const auroraGradient = `radial-gradient(ellipse at 50% 0%, rgba(124,58,237,0.3) 0%, transparent 60%),
radial-gradient(ellipse at 30% 50%, rgba(59,130,246,0.2) 0%, transparent 50%),
radial-gradient(ellipse at 70% 50%, rgba(139,92,246,0.15) 0%, transparent 50%),
#0a0a0a`;

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
      className={`rounded-xl overflow-hidden border ${dark ? "border-white/10" : "border-[#e5e5e5]"} ${className}`}
      style={{ background: dark ? "#111111" : "#fafaf9" }}
    >
      <div
        className={`flex items-center gap-2 px-4 py-2.5 border-b ${dark ? "border-white/10" : "border-[#e5e5e5]"}`}
      >
        <div className="flex gap-1.5">
          <div className="w-3 h-3 rounded-full bg-[#ff5f57]" />
          <div className="w-3 h-3 rounded-full bg-[#febc2e]" />
          <div className="w-3 h-3 rounded-full bg-[#28c840]" />
        </div>
        <span
          className={`text-xs ml-2 ${dark ? "text-[#666666]" : "text-[#999999]"}`}
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
        <span
          className="text-[#0a0a0a] text-lg font-bold tracking-tight"
          style={font.display}
        >
          otterdeploy
        </span>

        <div className="hidden md:flex items-center gap-6">
          {["Features", "Platform", "Pricing", "Docs"].map((item) => (
            <a
              key={item}
              href={`#${item.toLowerCase()}`}
              className="text-sm text-[#666666] hover:text-[#0a0a0a] transition-colors"
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
                  v.to === "/6"
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
            className="px-4 py-1.5 text-sm font-semibold rounded-lg bg-[#0a0a0a] text-white hover:bg-[#1a1a1a] transition-colors"
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
// Isometric Grid (Hero Visual)
// ---------------------------------------------------------------------------

const ACCENT_INDICES = [1, 4, 7];

const SATELLITE_NODES = [
  { label: ".WEB", x: 0, y: -70, bg: "#7c3aed", color: "#ffffff" },
  { label: ".API", x: -130, y: 60, bg: "#0a0a0a", color: "#ffffff" },
  { label: ".DB", x: 0, y: 190, bg: "#0a0a0a", color: "#ffffff" },
  { label: ".CACHE", x: 130, y: 60, bg: "#0a0a0a", color: "#ffffff" },
  { label: ".WORKER", x: 100, y: -50, bg: "#0a0a0a", color: "#ffffff" },
];

function IsometricDiagram() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-40px" });

  return (
    <div ref={ref} className="flex justify-center mt-20">
      <div className="relative" style={{ width: 500, height: 400 }}>
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
            style={{ width: 260, height: 260 }}
          >
            {Array.from({ length: 9 }).map((_, i) => {
              const isAccent = ACCENT_INDICES.includes(i);
              return (
                <motion.div
                  key={i}
                  className="rounded-lg flex items-center justify-center"
                  style={{
                    width: 80,
                    height: 80,
                    background: isAccent ? "#f3f0ff" : "#f8f8f8",
                    border: isAccent
                      ? "1.5px solid #7c3aed"
                      : "1px solid #e5e5e5",
                    boxShadow: "0 4px 0 0 #e5e5e5",
                  }}
                  initial={{ opacity: 0, scale: 0.5 }}
                  animate={inView ? { opacity: 1, scale: 1 } : {}}
                  transition={{
                    ...ease,
                    delay: 0.08 * i,
                    duration: 0.5,
                  }}
                />
              );
            })}
          </div>
        </div>

        {/* Satellite nodes — counter-rotated to appear flat */}
        {SATELLITE_NODES.map((node, i) => (
          <motion.div
            key={node.label}
            className="absolute rounded-md px-3 py-1"
            style={{
              left: `calc(50% + ${node.x}px)`,
              top: `calc(50% + ${node.y}px)`,
              transform: "translate(-50%, -50%)",
              background: node.bg,
              color: node.color,
              ...font.mono,
            }}
            initial={{ opacity: 0, scale: 0.8 }}
            animate={inView ? { opacity: 1, scale: 1 } : {}}
            transition={{ ...ease, delay: 0.5 + 0.1 * i }}
          >
            <span className="text-xs font-bold">{node.label}</span>
          </motion.div>
        ))}
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
    <section ref={ref} className="pt-28 pb-32 px-5 bg-white">
      <div className="max-w-5xl mx-auto text-center">
        <motion.div
          className="inline-flex items-center justify-center w-14 h-14 rounded-xl bg-[#f3f0ff] mb-8"
          initial={{ opacity: 0, y: 20 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ ...ease, delay: 0 }}
        >
          <Rocket size={24} className="text-[#7c3aed]" />
        </motion.div>

        <motion.h1
          className="text-5xl md:text-7xl font-extrabold text-[#0a0a0a] leading-[1.08] tracking-tight"
          style={font.display}
          initial={{ opacity: 0, y: 20 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ ...ease, delay: 0.1 }}
        >
          The Unified Platform
          <br />
          for Self-Hosted <span className="text-[#7c3aed]">Deploys</span>
        </motion.h1>

        <motion.p
          className="mt-6 text-lg text-[#666666] max-w-2xl mx-auto leading-relaxed"
          style={{ ...font.body, fontWeight: 400 }}
          initial={{ opacity: 0, y: 20 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ ...ease, delay: 0.2 }}
        >
          Define, deploy, and manage your entire infrastructure stack from a
          single config file — built for scale, speed, and sanity.
        </motion.p>

        <motion.div
          className="mt-8 flex items-center justify-center gap-3"
          initial={{ opacity: 0, y: 20 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ ...ease, delay: 0.3 }}
        >
          <a
            href="#cta"
            className="px-6 py-2.5 text-sm font-semibold rounded-lg bg-[#0a0a0a] text-white hover:bg-[#1a1a1a] transition-colors inline-flex items-center gap-2"
            style={font.display}
          >
            Get started <ArrowRight size={16} />
          </a>
          <a
            href="#features"
            className="px-6 py-2.5 text-sm font-semibold rounded-lg border border-[#e5e5e5] text-[#0a0a0a] hover:border-[#d4d4d4] transition-colors"
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
            Everything you need to ship
          </h2>
          <p
            className="mt-2 text-xl font-semibold text-[#0a0a0a]"
            style={font.display}
          >
            — plus everything you've been duct-taping together.
          </p>
          <p
            className="mt-4 text-base text-[#666666] max-w-xl leading-relaxed"
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

  return (
    <section
      ref={ref}
      className="py-28 px-5"
      style={{ background: auroraGradient }}
    >
      <div className="max-w-3xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={ease}
        >
          <TerminalWindow title="terminal">
            <div className="text-sm leading-relaxed min-h-[320px]">
              {DEPLOY_LINES.map((line, i) => (
                <motion.div
                  key={i}
                  className="whitespace-pre"
                  initial={{ opacity: 0 }}
                  animate={inView ? { opacity: 1 } : {}}
                  transition={{
                    ...ease,
                    delay: 0.08 * i,
                    duration: 0.4,
                  }}
                >
                  {line.type === "command" && (
                    <span className="text-[#e5e5e5]">{line.text}</span>
                  )}
                  {line.type === "blank" && <br />}
                  {line.type === "brand" && (
                    <span className="text-[#a78bfa]">{line.text}</span>
                  )}
                  {line.type === "header" && (
                    <span className="text-[#e5e5e5]">{line.text}</span>
                  )}
                  {line.type === "success" && (
                    <span>
                      <span className="text-[#4ade80]">
                        {line.text.slice(0, 3)}
                      </span>
                      <span className="text-[#e5e5e5]">
                        {line.text.slice(3).split("\u2192")[0]}
                      </span>
                      {line.text.includes("\u2192") && (
                        <>
                          <span className="text-[#666666]">{"\u2192 "}</span>
                          <span className="text-[#22d3ee]">
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
                </motion.div>
              ))}
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
      className="py-28 px-5 bg-white"
    >
      <div className="max-w-5xl mx-auto">
        <motion.h2
          className="text-4xl font-bold text-[#0a0a0a] tracking-tight mb-10"
          style={font.display}
          initial={{ opacity: 0, y: 15 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={ease}
        >
          Built for developers
        </motion.h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {/* Config as Code — 2 cols */}
          <motion.div
            className="md:col-span-2 rounded-xl border border-[#e5e5e5] bg-white p-6 hover:border-[#7c3aed]/30 transition-colors"
            initial={{ opacity: 0, scale: 0.97 }}
            animate={inView ? { opacity: 1, scale: 1 } : {}}
            transition={{ ...ease, delay: 0.05 }}
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
              Define your entire infrastructure in a single YAML file.
              Version-controlled, repeatable, auditable.
            </p>
            <div
              className="rounded-lg border border-[#e5e5e5] bg-[#fafaf9] p-4 text-xs leading-relaxed"
              style={font.mono}
            >
              {yamlSnippet.split("\n").map((line, i) => (
                <div key={i}>
                  {line.includes(":") ? (
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

          {/* Git Deploys — 1x1 */}
          <motion.div
            className="rounded-xl border border-[#e5e5e5] bg-white p-6 hover:border-[#7c3aed]/30 transition-colors"
            initial={{ opacity: 0, scale: 0.97 }}
            animate={inView ? { opacity: 1, scale: 1 } : {}}
            transition={{ ...ease, delay: 0.1 }}
          >
            <div className="flex items-center gap-2 mb-2">
              <GitBranch size={18} className="text-[#7c3aed]" />
              <h3
                className="text-base font-semibold text-[#0a0a0a]"
                style={font.display}
              >
                Git Deploys
              </h3>
            </div>
            <p
              className="text-sm text-[#666666] mb-4 leading-relaxed"
              style={font.body}
            >
              Push to deploy. Every commit triggers a build pipeline
              automatically.
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

          {/* Multi-Environment — 1x1 */}
          <motion.div
            className="rounded-xl border border-[#e5e5e5] bg-white p-6 hover:border-[#7c3aed]/30 transition-colors"
            initial={{ opacity: 0, scale: 0.97 }}
            animate={inView ? { opacity: 1, scale: 1 } : {}}
            transition={{ ...ease, delay: 0.15 }}
          >
            <div className="flex items-center gap-2 mb-2">
              <Layers size={18} className="text-[#7c3aed]" />
              <h3
                className="text-base font-semibold text-[#0a0a0a]"
                style={font.display}
              >
                Multi-Environment
              </h3>
            </div>
            <p
              className="text-sm text-[#666666] mb-4 leading-relaxed"
              style={font.body}
            >
              Staging inherits base, production inherits staging. Override only
              what differs.
            </p>
            <div className="flex flex-wrap gap-2">
              <span className="px-3 py-1 rounded-md text-xs font-medium bg-green-50 text-green-700 border border-green-200">
                production
              </span>
              <span className="px-3 py-1 rounded-md text-xs font-medium bg-purple-50 text-purple-700 border border-purple-200">
                staging
              </span>
              <span className="px-3 py-1 rounded-md text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200">
                development
              </span>
            </div>
          </motion.div>

          {/* Dashboard — 2 cols */}
          <motion.div
            className="md:col-span-2 rounded-xl border border-[#e5e5e5] bg-white p-6 hover:border-[#7c3aed]/30 transition-colors"
            initial={{ opacity: 0, scale: 0.97 }}
            animate={inView ? { opacity: 1, scale: 1 } : {}}
            transition={{ ...ease, delay: 0.2 }}
          >
            <div className="flex items-center gap-2 mb-2">
              <Activity size={18} className="text-[#7c3aed]" />
              <h3
                className="text-base font-semibold text-[#0a0a0a]"
                style={font.display}
              >
                Real-time Dashboard
              </h3>
            </div>
            <p
              className="text-sm text-[#666666] mb-4 leading-relaxed"
              style={font.body}
            >
              Monitor your entire stack from a single pane. Live logs, metrics,
              health checks, and deployment status.
            </p>
            <div className="flex items-center gap-3 flex-wrap">
              {["web :3000", "api :8080", "postgres", "redis"].map((s, i) => (
                <div key={s} className="flex items-center gap-2">
                  <div
                    className="px-3 py-2 rounded-md border border-[#e5e5e5] bg-[#f8f8f8] text-xs"
                    style={font.mono}
                  >
                    <span className="text-[#0a0a0a]">{s}</span>
                  </div>
                  {i < 3 && <div className="w-6 h-px bg-[#e5e5e5]" />}
                </div>
              ))}
              <span
                className="ml-2 text-xs text-[#4ade80] flex items-center gap-1"
                style={font.mono}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-[#4ade80]" />
                all healthy
              </span>
            </div>
          </motion.div>

          {/* Secrets — 1x1 */}
          <motion.div
            className="rounded-xl border border-[#e5e5e5] bg-white p-6 hover:border-[#7c3aed]/30 transition-colors"
            initial={{ opacity: 0, scale: 0.97 }}
            animate={inView ? { opacity: 1, scale: 1 } : {}}
            transition={{ ...ease, delay: 0.25 }}
          >
            <div className="flex items-center gap-2 mb-2">
              <Lock size={18} className="text-[#7c3aed]" />
              <h3
                className="text-base font-semibold text-[#0a0a0a]"
                style={font.display}
              >
                Secrets Management
              </h3>
            </div>
            <p
              className="text-sm text-[#666666] mb-4 leading-relaxed"
              style={font.body}
            >
              Encrypted secrets, scoped per environment. Rotate without
              restarts or downtime.
            </p>
            <div className="flex justify-center py-2">
              <Lock size={36} className="text-[#7c3aed]/40" />
            </div>
          </motion.div>

          {/* RBAC — 1x1 */}
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
                RBAC & Teams
              </h3>
            </div>
            <p
              className="text-sm text-[#666666] leading-relaxed"
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
      id="platform"
      ref={ref}
      className="py-28 px-5"
      style={{ background: auroraGradient }}
    >
      <div className="max-w-6xl mx-auto">
        <motion.h2
          className="text-3xl md:text-4xl font-bold text-white text-center tracking-tight mb-10"
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
              className={`flex items-center gap-2 px-4 py-2 text-sm rounded-lg border transition-colors ${
                activeTab === key
                  ? "bg-[#7c3aed]/20 border-[#7c3aed]/40 text-white"
                  : "border-transparent text-white/60 hover:text-white"
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
          transition={{ ...ease, duration: 0.4 }}
        >
          {/* Left: text */}
          <div className="py-2">
            <span
              className="text-xs text-[#a78bfa] uppercase tracking-wider mb-3 block"
              style={font.mono}
            >
              {data.label}
            </span>
            <h3
              className="text-2xl font-bold text-white mb-5"
              style={font.display}
            >
              {data.heading}
            </h3>
            <ul className="flex flex-col gap-3">
              {data.bullets.map((b) => (
                <li key={b} className="flex items-center gap-3">
                  <span className="text-[#7c3aed]">
                    <Check size={16} />
                  </span>
                  <span
                    className="text-sm text-white/70"
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
                    <div key={i} className="text-[#666666]">
                      {line}
                    </div>
                  );
                }
                if (line.startsWith("$") || line.startsWith("\u2192")) {
                  return (
                    <div key={i} className="text-[#e5e5e5]">
                      {line}
                    </div>
                  );
                }
                if (line.startsWith("\u25b8")) {
                  return (
                    <div key={i} className="text-[#e5e5e5]">
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
                      <span className="text-[#e5e5e5]">
                        {line.slice(line.indexOf("\u2713") + 1).split("\u2192")[0]}
                      </span>
                      {line.includes("\u2192") && (
                        <>
                          <span className="text-[#666666]">{"\u2192 "}</span>
                          <span className="text-[#22d3ee]">
                            {line.split("\u2192")[1].trim()}
                          </span>
                        </>
                      )}
                    </div>
                  );
                }
                if (line.trim().includes(":")) {
                  const colonIdx = line.indexOf(":");
                  return (
                    <div key={i}>
                      <span className="text-[#a78bfa]">
                        {line.slice(0, colonIdx + 1)}
                      </span>
                      <span className="text-[#e5e5e5]">
                        {line.slice(colonIdx + 1)}
                      </span>
                    </div>
                  );
                }
                return (
                  <div key={i} className="text-[#e5e5e5]">
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
// Stats Row
// ---------------------------------------------------------------------------

const STATS = [
  { icon: <Rocket size={20} />, value: "4,200+", label: "deploys" },
  { icon: <Activity size={20} />, value: "99.9%", label: "uptime" },
  { icon: <Terminal size={20} />, value: "<30s", label: "build time" },
  { icon: <Maximize size={20} />, value: "\u221e", label: "scalability" },
];

function StatsRow() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-60px" });

  return (
    <section ref={ref} className="border-t border-b border-[#e5e5e5] bg-white">
      <div className="max-w-5xl mx-auto grid grid-cols-2 md:grid-cols-4">
        {STATS.map((stat, i) => (
          <motion.div
            key={stat.label}
            className={`py-10 px-6 text-center ${
              i < STATS.length - 1
                ? "md:border-r md:border-[#e5e5e5]"
                : ""
            } ${i % 2 === 0 && i < 2 ? "border-r border-[#e5e5e5] md:border-r" : ""}`}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={inView ? { opacity: 1, scale: 1 } : {}}
            transition={{ ...ease, delay: 0.08 * i }}
          >
            <div className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-[#f3f0ff] text-[#7c3aed] mb-3">
              {stat.icon}
            </div>
            <div
              className="text-4xl md:text-5xl font-bold text-[#0a0a0a] mb-1"
              style={font.display}
            >
              {stat.value}
            </div>
            <div
              className="text-sm text-[#999999]"
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
      className="py-28 px-5 bg-[#f8f8f8] border-t border-[#e5e5e5]"
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
            Focus on shipping, not tooling
          </h3>
          <ul className="flex flex-col gap-3">
            {productBullets.map((b) => (
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
            Supply chain security
          </h3>
          <ul className="flex flex-col gap-3">
            {securityBullets.map((b) => (
              <li key={b} className="flex items-start gap-3">
                <Check
                  size={16}
                  className="text-[#7c3aed] mt-0.5 shrink-0"
                />
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
      id="pricing"
      ref={ref}
      className="py-28 px-5 bg-white border-t border-[#e5e5e5]"
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
              className="text-3xl font-bold text-[#0a0a0a] mb-3"
              style={font.display}
            >
              License & Pricing
            </h2>
            <p
              className="text-sm text-[#666666] leading-relaxed"
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
              className="text-xs text-[#999999] uppercase tracking-wider"
              style={font.mono}
            >
              Community
            </span>
            <div
              className="text-4xl font-bold text-[#0a0a0a] mt-2"
              style={font.display}
            >
              Free
            </div>
            <p className="text-sm text-[#666666] mt-2" style={font.body}>
              All core features, unlimited deploys, community support.
            </p>
          </motion.div>

          {/* Team / Pro */}
          <motion.div
            className="p-8 border-t md:border-t border-r border-[#e5e5e5]"
            initial={{ opacity: 0, y: 15 }}
            animate={inView ? { opacity: 1, y: 0 } : {}}
            transition={{ ...ease, delay: 0.15 }}
          >
            <span
              className="text-xs text-[#7c3aed] uppercase tracking-wider font-medium"
              style={font.mono}
            >
              Team (Pro)
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
            <p className="text-sm text-[#666666] mt-2" style={font.body}>
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
            <p className="text-sm text-[#666666] mt-2" style={font.body}>
              Dedicated support, SLA, custom integrations, on-prem.
            </p>
          </motion.div>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// CTA (Dark with aurora)
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
      className="py-32 px-5"
      style={{ background: auroraGradient }}
    >
      <div className="max-w-2xl mx-auto text-center">
        <motion.h2
          className="text-4xl md:text-5xl font-bold text-white tracking-tight"
          style={font.display}
          initial={{ opacity: 0, y: 20 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={ease}
        >
          Take your infrastructure to the next level
        </motion.h2>

        <motion.div
          className="mt-8"
          initial={{ opacity: 0, y: 15 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ ...ease, delay: 0.15 }}
        >
          <button
            onClick={handleCopy}
            className="w-full max-w-lg mx-auto flex items-center justify-between px-5 py-3.5 rounded-xl border border-white/10 bg-[#111111] hover:border-[#7c3aed]/40 transition-colors group"
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
              className="px-6 py-2.5 rounded-lg bg-white text-[#0a0a0a] text-sm font-semibold hover:bg-gray-100 transition-colors inline-flex items-center gap-2"
              style={font.display}
            >
              Get started <ArrowRight size={16} />
            </a>
            <a
              href="#"
              className="px-6 py-2.5 rounded-lg border border-white/20 text-white text-sm font-semibold hover:border-white/40 transition-colors inline-flex items-center gap-2"
              style={font.display}
            >
              Learn more
            </a>
          </div>

          <span className="text-xs text-white/60" style={font.mono}>
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
    <footer className="px-5 py-12 bg-[#0a0a0a] border-t border-white/10">
      <div className="max-w-7xl mx-auto">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
          {/* Brand */}
          <div>
            <span
              className="text-white font-bold tracking-tight block mb-3"
              style={font.display}
            >
              otterdeploy
            </span>
            <p
              className="text-sm text-white/60 leading-relaxed"
              style={font.body}
            >
              Self-hosted PaaS for teams that ship.
            </p>
            <div className="flex items-center gap-3 mt-4">
              <a
                href="#"
                className="text-white/60 hover:text-white transition-colors"
              >
                <Github size={16} />
              </a>
              <a
                href="#"
                className="text-white/60 hover:text-white transition-colors"
              >
                <Twitter size={16} />
              </a>
            </div>
            <div className="flex items-center gap-1 mt-4">
              {VARIANT_LINKS.map((v) => (
                <Link
                  key={v.to}
                  to={v.to}
                  className={`w-6 h-6 flex items-center justify-center text-xs rounded transition-colors ${
                    v.to === "/6"
                      ? "bg-[#7c3aed]/20 text-[#a78bfa]"
                      : "text-white/40 hover:text-white/70"
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
                className="text-xs text-white/40 uppercase tracking-wider mb-3"
                style={font.mono}
              >
                {col.title}
              </h5>
              <div className="flex flex-col gap-2">
                {col.links.map((link) => (
                  <a
                    key={link}
                    href="#"
                    className="text-sm text-white/60 hover:text-white transition-colors"
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
        <div className="mt-10 pt-6 border-t border-white/10 flex flex-wrap items-center justify-between gap-4">
          <span className="text-xs text-white/40" style={font.mono}>
            &copy; 2026 otterdeploy
          </span>
          <span className="text-xs text-white/40" style={font.mono}>
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
    <div className="bg-white text-[#0a0a0a] min-h-screen" style={font.body}>
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
