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
  Star,
  Download,
  Users,
  GitCommit,
  Server,
  Database,
  Globe,
  Zap,
  Heart,
} from "lucide-react";

export const Route = createFileRoute("/11")({
  component: RouteComponent,
});

// ---------------------------------------------------------------------------
// Font Loader
// ---------------------------------------------------------------------------

function useFonts() {
  useEffect(() => {
    const id = "dark-paas-v11-fonts";
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

const ACCENT_INDICES = [1, 4, 7];

const SATELLITE_NODES = [
  { label: ".WEB", x: 0, y: -70, accent: true },
  { label: ".API", x: -130, y: 60, accent: false },
  { label: ".DB", x: 0, y: 190, accent: false },
  { label: ".CACHE", x: 130, y: 60, accent: false },
  { label: ".WORKER", x: 100, y: -50, accent: false },
];

const TESTIMONIALS = [
  {
    quote: "Switched from Heroku to Otterdeploy in 10 minutes. Never looking back.",
    name: "Sarah Chen",
    handle: "@sarahdev",
    initials: "SC",
    color: "#7c3aed",
  },
  {
    quote: "The best open-source PaaS I've used. Config-as-code is a game changer.",
    name: "Mike Ostrowski",
    handle: "@mikeops",
    initials: "MO",
    color: "#3b82f6",
  },
  {
    quote: "Finally, infrastructure I can actually version control.",
    name: "Jane Park",
    handle: "@devjane",
    initials: "JP",
    color: "#22d3ee",
  },
];

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

const auroraGradient = `radial-gradient(ellipse at 50% 0%, rgba(124,58,237,0.15) 0%, transparent 50%), radial-gradient(ellipse at 80% 20%, rgba(59,130,246,0.08) 0%, transparent 40%), #09090b`;

const gridPattern = {
  backgroundImage:
    "radial-gradient(rgba(255,255,255,0.03) 1px, transparent 1px)",
  backgroundSize: "24px 24px",
};

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
      style={{ background: "rgba(0,0,0,0.5)" }}
    >
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-white/[0.08]">
        <div className="flex gap-1.5">
          <div className="w-3 h-3 rounded-full bg-[#ff5f57]" />
          <div className="w-3 h-3 rounded-full bg-[#febc2e]" />
          <div className="w-3 h-3 rounded-full bg-[#28c840]" />
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

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

function Nav() {
  return (
    <nav
      className="fixed top-0 left-0 right-0 z-50 border-b border-white/[0.08]"
      style={{ background: "rgba(9,9,11,0.8)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)" }}
    >
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
          {["Features", "Docs", "Community", "GitHub"].map((item) => (
            <a
              key={item}
              href={`#${item.toLowerCase()}`}
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
                  v.to === "/11"
                    ? "bg-[#7c3aed]/15 text-[#7c3aed] font-medium"
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
// Isometric Grid (Hero Visual)
// ---------------------------------------------------------------------------

function IsometricDiagram() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-40px" });

  return (
    <div ref={ref} className="flex justify-center mt-20">
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
                    background: isAccent
                      ? "rgba(124,58,237,0.05)"
                      : "#18181b",
                    border: isAccent
                      ? "1.5px solid rgba(124,58,237,0.3)"
                      : "1px solid rgba(255,255,255,0.08)",
                    boxShadow: "0 4px 0 0 rgba(255,255,255,0.03)",
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

        {SATELLITE_NODES.map((node, i) => (
          <motion.div
            key={node.label}
            className="absolute rounded-md px-3 py-1"
            style={{
              left: `calc(50% + ${node.x}px)`,
              top: `calc(50% + ${node.y}px)`,
              transform: "translate(-50%, -50%)",
              background: node.accent ? "#7c3aed" : "#27272a",
              color: "#fafafa",
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
  const [copied, setCopied] = useState(false);

  const installCmd = "curl -fsSL https://get.otterdeploy.sh | sh";

  const handleCopy = () => {
    navigator.clipboard.writeText(installCmd);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <section
      ref={ref}
      className="pt-28 pb-32 px-5"
      style={{ background: "#09090b", ...gridPattern }}
    >
      <div className="max-w-5xl mx-auto text-center">
        <motion.div
          className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-white/[0.1] mb-8"
          style={{ background: "rgba(255,255,255,0.03)" }}
          initial={{ opacity: 0, y: 10 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ ...ease, delay: 0.05 }}
        >
          <span className="text-sm text-[#a1a1aa]" style={font.body}>
            Open Source &middot; Self-Hosted &middot; MIT License
          </span>
        </motion.div>

        <motion.h1
          className="text-5xl md:text-7xl font-extrabold text-[#fafafa] leading-[1.08] tracking-tight"
          style={font.display}
          initial={{ opacity: 0, y: 20 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ ...ease, delay: 0.1 }}
        >
          Self-Hosted Deploys
          <br />
          With <span className="text-[#7c3aed]">Superpowers</span>
        </motion.h1>

        <motion.p
          className="mt-6 text-lg text-[#a1a1aa] max-w-2xl mx-auto leading-relaxed"
          style={{ ...font.body, fontWeight: 400 }}
          initial={{ opacity: 0, y: 15 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ ...ease, delay: 0.2 }}
        >
          Deploy any application, database, or service on your own servers.
          Open source, community-driven, no vendor lock-in.
        </motion.p>

        <motion.div
          className="mt-8 max-w-lg mx-auto"
          initial={{ opacity: 0, y: 10 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ ...ease, delay: 0.3 }}
        >
          <button
            onClick={handleCopy}
            className="w-full flex items-center justify-between px-5 py-3.5 rounded-xl border border-white/[0.08] bg-[#18181b] hover:border-[#7c3aed]/40 transition-colors group"
          >
            <span className="text-sm text-[#a78bfa]" style={font.mono}>
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
          transition={{ ...ease, delay: 0.4 }}
        >
          <a
            href="#cta"
            className="px-6 py-2.5 text-sm font-semibold rounded-lg bg-[#7c3aed] text-white hover:bg-[#6d28d9] transition-colors inline-flex items-center gap-2"
            style={font.display}
          >
            Get Started <ArrowRight size={16} />
          </a>
          <a
            href="#"
            className="px-6 py-2.5 text-sm font-semibold rounded-lg border border-white/[0.1] text-[#fafafa] hover:border-white/[0.2] transition-colors inline-flex items-center gap-2"
            style={font.display}
          >
            <Star size={14} /> Star on GitHub
            <span className="text-[#a1a1aa] text-xs ml-1">2.4k</span>
          </a>
        </motion.div>

        <IsometricDiagram />
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Stats Bar (Dokploy-inspired)
// ---------------------------------------------------------------------------

const GITHUB_STATS = [
  { icon: <Star size={20} />, value: "2.4k", label: "GitHub Stars" },
  { icon: <Download size={20} />, value: "18k+", label: "Weekly Downloads" },
  { icon: <Users size={20} />, value: "42", label: "Contributors" },
  { icon: <GitCommit size={20} />, value: "847", label: "Commits" },
];

function StatsBar() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-60px" });

  return (
    <section
      ref={ref}
      className="border-y border-white/[0.08]"
      style={{ background: "rgba(255,255,255,0.02)" }}
    >
      <div className="max-w-5xl mx-auto grid grid-cols-2 md:grid-cols-4">
        {GITHUB_STATS.map((stat, i) => (
          <motion.div
            key={stat.label}
            className={`py-10 px-6 text-center ${
              i < GITHUB_STATS.length - 1
                ? "md:border-r md:border-white/[0.08]"
                : ""
            } ${i % 2 === 0 && i < 2 ? "border-r border-white/[0.08] md:border-r" : ""}`}
            initial={{ opacity: 0, y: 15 }}
            animate={inView ? { opacity: 1, y: 0 } : {}}
            transition={{ ...ease, delay: 0.08 * i }}
          >
            <div className="inline-flex items-center justify-center w-10 h-10 rounded-lg text-[#7c3aed] mb-3"
              style={{ background: "rgba(124,58,237,0.1)" }}
            >
              {stat.icon}
            </div>
            <div
              className="text-4xl font-bold text-[#fafafa] mb-1"
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
// Everything You Need
// ---------------------------------------------------------------------------

function EverythingSection() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });

  return (
    <section
      ref={ref}
      className="py-24 px-5"
      style={{ background: "#0c0c0f" }}
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
            Everything you need to deploy
          </h2>
          <p
            className="mt-2 text-xl font-semibold text-[#fafafa]"
            style={font.display}
          >
            — self-hosted, open source, no limits.
          </p>
          <p
            className="mt-4 text-base text-[#a1a1aa] max-w-xl leading-relaxed"
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
      className="py-28 px-5"
      style={{ background: "#09090b", ...gridPattern }}
    >
      <div className="max-w-5xl mx-auto">
        <motion.h2
          className="text-4xl font-bold text-[#fafafa] tracking-tight mb-10"
          style={font.display}
          initial={{ opacity: 0, y: 15 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={ease}
        >
          Built for developers
        </motion.h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {/* Config as Code -- 2 cols */}
          <motion.div
            className="md:col-span-2 rounded-xl border border-white/[0.08] p-6 hover:border-[#7c3aed]/20 transition-colors"
            style={{ background: "rgba(24,24,27,0.5)" }}
            initial={{ opacity: 0, scale: 0.97 }}
            animate={inView ? { opacity: 1, scale: 1 } : {}}
            transition={{ ...ease, delay: 0.05 }}
          >
            <div className="flex items-center gap-2 mb-2">
              <FileCode size={18} className="text-[#7c3aed]" />
              <h3
                className="text-base font-semibold text-[#fafafa]"
                style={font.display}
              >
                Config as Code
              </h3>
            </div>
            <p
              className="text-sm text-[#a1a1aa] mb-4 leading-relaxed"
              style={font.body}
            >
              Define your entire infrastructure in a single YAML file.
              Version-controlled, repeatable, auditable.
            </p>
            <div
              className="rounded-lg border border-white/[0.08] p-4 text-xs leading-relaxed"
              style={{ background: "rgba(0,0,0,0.5)", ...font.mono }}
            >
              {yamlSnippet.split("\n").map((line, i) => (
                <div key={i}>
                  {line.includes(":") ? (
                    <span>
                      <span className="text-[#a78bfa]">
                        {line.split(":")[0]}:
                      </span>
                      <span className="text-[#fafafa]">
                        {line.slice(line.indexOf(":") + 1)}
                      </span>
                    </span>
                  ) : (
                    <span className="text-[#fafafa]">{line}</span>
                  )}
                </div>
              ))}
            </div>
          </motion.div>

          {/* Git Deploys -- 1x1 */}
          <motion.div
            className="rounded-xl border border-white/[0.08] p-6 hover:border-[#7c3aed]/20 transition-colors"
            style={{ background: "rgba(24,24,27,0.5)" }}
            initial={{ opacity: 0, scale: 0.97 }}
            animate={inView ? { opacity: 1, scale: 1 } : {}}
            transition={{ ...ease, delay: 0.1 }}
          >
            <div className="flex items-center gap-2 mb-2">
              <GitBranch size={18} className="text-[#7c3aed]" />
              <h3
                className="text-base font-semibold text-[#fafafa]"
                style={font.display}
              >
                Git Deploys
              </h3>
            </div>
            <p
              className="text-sm text-[#a1a1aa] mb-4 leading-relaxed"
              style={font.body}
            >
              Push to deploy. Every commit triggers a build pipeline
              automatically.
            </p>
            <div
              className="rounded-lg p-3 text-[11px] leading-relaxed text-[#4ade80]"
              style={{ background: "rgba(0,0,0,0.5)", ...font.mono }}
            >
              {gitSnippet.split("\n").map((line, i) => (
                <div key={i} className="whitespace-pre">
                  {line}
                </div>
              ))}
            </div>
          </motion.div>

          {/* Multi-Environment -- 1x1 */}
          <motion.div
            className="rounded-xl border border-white/[0.08] p-6 hover:border-[#7c3aed]/20 transition-colors"
            style={{ background: "rgba(24,24,27,0.5)" }}
            initial={{ opacity: 0, scale: 0.97 }}
            animate={inView ? { opacity: 1, scale: 1 } : {}}
            transition={{ ...ease, delay: 0.15 }}
          >
            <div className="flex items-center gap-2 mb-2">
              <Layers size={18} className="text-[#7c3aed]" />
              <h3
                className="text-base font-semibold text-[#fafafa]"
                style={font.display}
              >
                Multi-Environment
              </h3>
            </div>
            <p
              className="text-sm text-[#a1a1aa] mb-4 leading-relaxed"
              style={font.body}
            >
              Staging inherits base, production inherits staging. Override only
              what differs.
            </p>
            <div className="flex flex-wrap gap-2">
              <span className="px-3 py-1 rounded-md text-xs font-medium bg-[#4ade80]/10 text-[#4ade80] border border-[#4ade80]/20">
                production
              </span>
              <span className="px-3 py-1 rounded-md text-xs font-medium bg-[#a78bfa]/10 text-[#a78bfa] border border-[#a78bfa]/20">
                staging
              </span>
              <span className="px-3 py-1 rounded-md text-xs font-medium bg-[#3b82f6]/10 text-[#3b82f6] border border-[#3b82f6]/20">
                development
              </span>
            </div>
          </motion.div>

          {/* Dashboard -- 2 cols */}
          <motion.div
            className="md:col-span-2 rounded-xl border border-white/[0.08] p-6 hover:border-[#7c3aed]/20 transition-colors"
            style={{ background: "rgba(24,24,27,0.5)" }}
            initial={{ opacity: 0, scale: 0.97 }}
            animate={inView ? { opacity: 1, scale: 1 } : {}}
            transition={{ ...ease, delay: 0.2 }}
          >
            <div className="flex items-center gap-2 mb-2">
              <Activity size={18} className="text-[#7c3aed]" />
              <h3
                className="text-base font-semibold text-[#fafafa]"
                style={font.display}
              >
                Real-time Dashboard
              </h3>
            </div>
            <p
              className="text-sm text-[#a1a1aa] mb-4 leading-relaxed"
              style={font.body}
            >
              Monitor your entire stack from a single pane. Live logs, metrics,
              health checks, and deployment status.
            </p>
            <div className="flex items-center gap-3 flex-wrap">
              {["web :3000", "api :8080", "postgres", "redis"].map((s, i) => (
                <div key={s} className="flex items-center gap-2">
                  <div
                    className="px-3 py-2 rounded-md border border-white/[0.08] text-xs"
                    style={{ background: "#18181b", ...font.mono }}
                  >
                    <span className="text-[#fafafa]">{s}</span>
                  </div>
                  {i < 3 && <div className="w-6 h-px bg-white/[0.08]" />}
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

          {/* Secrets -- 1x1 */}
          <motion.div
            className="rounded-xl border border-white/[0.08] p-6 hover:border-[#7c3aed]/20 transition-colors"
            style={{ background: "rgba(24,24,27,0.5)" }}
            initial={{ opacity: 0, scale: 0.97 }}
            animate={inView ? { opacity: 1, scale: 1 } : {}}
            transition={{ ...ease, delay: 0.25 }}
          >
            <div className="flex items-center gap-2 mb-2">
              <Lock size={18} className="text-[#7c3aed]" />
              <h3
                className="text-base font-semibold text-[#fafafa]"
                style={font.display}
              >
                Secrets Management
              </h3>
            </div>
            <p
              className="text-sm text-[#a1a1aa] mb-4 leading-relaxed"
              style={font.body}
            >
              Encrypted secrets, scoped per environment. Rotate without
              restarts or downtime.
            </p>
            <div className="flex justify-center py-2">
              <Lock size={36} className="text-[#7c3aed]/40" />
            </div>
          </motion.div>

          {/* RBAC -- 1x1 */}
          <motion.div
            className="rounded-xl border border-white/[0.08] p-6 hover:border-[#7c3aed]/20 transition-colors"
            style={{ background: "rgba(24,24,27,0.5)" }}
            initial={{ opacity: 0, scale: 0.97 }}
            animate={inView ? { opacity: 1, scale: 1 } : {}}
            transition={{ ...ease, delay: 0.3 }}
          >
            <div className="flex items-center gap-2 mb-2">
              <Shield size={18} className="text-[#7c3aed]" />
              <h3
                className="text-base font-semibold text-[#fafafa]"
                style={font.display}
              >
                RBAC & Teams
              </h3>
            </div>
            <p
              className="text-sm text-[#a1a1aa] leading-relaxed"
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
// Feature Tabs
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
          className="text-3xl md:text-4xl font-bold text-[#fafafa] text-center tracking-tight mb-10"
          style={font.display}
          initial={{ opacity: 0, y: 15 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={ease}
        >
          Everything in one platform
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
                  ? "bg-[#7c3aed]/15 border-[#7c3aed]/30 text-[#fafafa]"
                  : "border-transparent text-[#a1a1aa] hover:text-[#fafafa]"
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
              className="text-2xl font-bold text-[#fafafa] mb-5"
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
                    className="text-sm text-[#a1a1aa]"
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
                    <div key={i} className="text-[#71717a]">
                      {line}
                    </div>
                  );
                }
                if (line.startsWith("$") || line.startsWith("\u2192")) {
                  return (
                    <div key={i} className="text-[#fafafa]">
                      {line}
                    </div>
                  );
                }
                if (line.startsWith("\u25b8")) {
                  return (
                    <div key={i} className="text-[#fafafa]">
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
// Community / Testimonials
// ---------------------------------------------------------------------------

function CommunitySection() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });

  return (
    <section
      ref={ref}
      className="py-28 px-5"
      style={{ background: "#09090b", ...gridPattern }}
    >
      <div className="max-w-5xl mx-auto">
        <motion.h2
          className="text-3xl md:text-4xl font-bold text-[#fafafa] text-center tracking-tight mb-4"
          style={font.display}
          initial={{ opacity: 0, y: 15 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={ease}
        >
          Loved by the community
        </motion.h2>
        <motion.p
          className="text-center text-[#a1a1aa] mb-12"
          style={font.body}
          initial={{ opacity: 0, y: 10 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ ...ease, delay: 0.1 }}
        >
          Join thousands of developers who deploy with confidence.
        </motion.p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {TESTIMONIALS.map((t, i) => (
            <motion.div
              key={t.handle}
              className="rounded-xl border border-white/[0.08] p-6"
              style={{ background: "rgba(24,24,27,0.5)" }}
              initial={{ opacity: 0, y: 20 }}
              animate={inView ? { opacity: 1, y: 0 } : {}}
              transition={{ ...ease, delay: 0.15 + 0.1 * i }}
            >
              <p
                className="text-sm text-[#fafafa] leading-relaxed mb-6"
                style={font.body}
              >
                "{t.quote}"
              </p>
              <div className="flex items-center gap-3">
                <div
                  className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold text-white"
                  style={{ background: t.color, ...font.mono }}
                >
                  {t.initials}
                </div>
                <div>
                  <div
                    className="text-sm font-medium text-[#fafafa]"
                    style={font.body}
                  >
                    {t.name}
                  </div>
                  <div
                    className="text-xs text-[#71717a]"
                    style={font.mono}
                  >
                    {t.handle}
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
// Stats Row
// ---------------------------------------------------------------------------

const STATS = [
  { icon: <Rocket size={20} />, value: "4,200+", label: "deploys" },
  { icon: <Activity size={20} />, value: "99.9%", label: "uptime" },
  { icon: <Zap size={20} />, value: "<30s", label: "build time" },
  { icon: <Shield size={20} />, value: "MIT", label: "license" },
];

function StatsRow() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-60px" });

  return (
    <section
      ref={ref}
      className="border-y border-white/[0.08]"
      style={{ background: "rgba(255,255,255,0.02)" }}
    >
      <div className="max-w-5xl mx-auto grid grid-cols-2 md:grid-cols-4">
        {STATS.map((stat, i) => (
          <motion.div
            key={stat.label}
            className={`py-10 px-6 text-center ${
              i < STATS.length - 1
                ? "md:border-r md:border-white/[0.08]"
                : ""
            } ${i % 2 === 0 && i < 2 ? "border-r border-white/[0.08] md:border-r" : ""}`}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={inView ? { opacity: 1, scale: 1 } : {}}
            transition={{ ...ease, delay: 0.08 * i }}
          >
            <div
              className="inline-flex items-center justify-center w-10 h-10 rounded-lg text-[#7c3aed] mb-3"
              style={{ background: "rgba(124,58,237,0.1)" }}
            >
              {stat.icon}
            </div>
            <div
              className="text-4xl md:text-5xl font-bold text-[#fafafa] mb-1"
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
// Two Columns
// ---------------------------------------------------------------------------

function TwoColumns() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });

  const selfHostBullets = [
    "Data sovereignty — your servers, your rules",
    "No surprise bills or usage-based pricing",
    "Compliance-ready for regulated industries",
    "Full customization and extensibility",
    "Unlimited resources — scale to your hardware",
  ];

  const openSourceBullets = [
    "MIT licensed — use it anywhere, for anything",
    "Transparent development on GitHub",
    "Community-driven roadmap and priorities",
    "42+ contributors and growing",
    "Regular releases with full changelogs",
  ];

  return (
    <section
      ref={ref}
      className="py-28 px-5"
      style={{ background: "#18181b" }}
    >
      <div className="max-w-5xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-16">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ ...ease, delay: 0.05 }}
        >
          <div className="flex items-center gap-2 mb-6">
            <Server size={20} className="text-[#7c3aed]" />
            <h3
              className="text-2xl font-bold text-[#fafafa]"
              style={font.display}
            >
              Why self-host?
            </h3>
          </div>
          <ul className="flex flex-col gap-3">
            {selfHostBullets.map((b) => (
              <li key={b} className="flex items-start gap-3">
                <span className="w-1.5 h-1.5 rounded-full bg-[#7c3aed] mt-2 shrink-0" />
                <span
                  className="text-sm text-[#a1a1aa] leading-relaxed"
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
          <div className="flex items-center gap-2 mb-6">
            <Heart size={20} className="text-[#7c3aed]" />
            <h3
              className="text-2xl font-bold text-[#fafafa]"
              style={font.display}
            >
              Open source, always
            </h3>
          </div>
          <ul className="flex flex-col gap-3">
            {openSourceBullets.map((b) => (
              <li key={b} className="flex items-start gap-3">
                <Check
                  size={16}
                  className="text-[#7c3aed] mt-0.5 shrink-0"
                />
                <span
                  className="text-sm text-[#a1a1aa] leading-relaxed"
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
// Pricing
// ---------------------------------------------------------------------------

function PricingGrid() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });

  return (
    <section
      id="pricing"
      ref={ref}
      className="py-28 px-5 border-t border-white/[0.08]"
      style={{ background: "#09090b" }}
    >
      <div className="max-w-4xl mx-auto">
        <motion.h2
          className="text-3xl md:text-4xl font-bold text-[#fafafa] text-center tracking-tight mb-12"
          style={font.display}
          initial={{ opacity: 0, y: 15 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={ease}
        >
          Simple, transparent pricing
        </motion.h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Community */}
          <motion.div
            className="rounded-xl border border-white/[0.08] p-8"
            style={{ background: "rgba(24,24,27,0.5)" }}
            initial={{ opacity: 0, y: 15 }}
            animate={inView ? { opacity: 1, y: 0 } : {}}
            transition={{ ...ease, delay: 0.05 }}
          >
            <span
              className="text-xs text-[#a1a1aa] uppercase tracking-wider"
              style={font.mono}
            >
              Community
            </span>
            <div
              className="text-4xl font-bold text-[#fafafa] mt-3 mb-4"
              style={font.display}
            >
              Free
            </div>
            <p className="text-sm text-[#a1a1aa] leading-relaxed" style={font.body}>
              All core features, unlimited deploys, community support. Forever free.
            </p>
          </motion.div>

          {/* Pro */}
          <motion.div
            className="rounded-xl border border-[#7c3aed]/30 p-8"
            style={{ background: "rgba(124,58,237,0.05)" }}
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
            <div className="mt-3 mb-4">
              <span
                className="text-4xl font-bold text-[#fafafa]"
                style={font.display}
              >
                $29
              </span>
              <span className="text-sm text-[#71717a] ml-1">/mo</span>
            </div>
            <p className="text-sm text-[#a1a1aa] leading-relaxed" style={font.body}>
              Priority support, advanced RBAC, SSO, audit logs.
            </p>
          </motion.div>

          {/* Enterprise */}
          <motion.div
            className="rounded-xl border border-white/[0.08] p-8"
            style={{ background: "rgba(24,24,27,0.5)" }}
            initial={{ opacity: 0, y: 15 }}
            animate={inView ? { opacity: 1, y: 0 } : {}}
            transition={{ ...ease, delay: 0.15 }}
          >
            <span
              className="text-xs text-[#a1a1aa] uppercase tracking-wider"
              style={font.mono}
            >
              Enterprise
            </span>
            <div
              className="text-4xl font-bold text-[#fafafa] mt-3 mb-4"
              style={font.display}
            >
              Custom
            </div>
            <p className="text-sm text-[#a1a1aa] leading-relaxed" style={font.body}>
              Dedicated support, SLA, custom integrations, on-prem.
            </p>
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
          className="text-4xl md:text-5xl font-bold text-[#fafafa] tracking-tight"
          style={font.display}
          initial={{ opacity: 0, y: 20 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={ease}
        >
          Start deploying on your own servers
        </motion.h2>

        <motion.div
          className="mt-8"
          initial={{ opacity: 0, y: 15 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ ...ease, delay: 0.15 }}
        >
          <button
            onClick={handleCopy}
            className="w-full max-w-lg mx-auto flex items-center justify-between px-5 py-3.5 rounded-xl border border-white/[0.08] bg-[#18181b] hover:border-[#7c3aed]/40 transition-colors group"
          >
            <span className="text-sm text-[#a78bfa]" style={font.mono}>
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
              className="px-6 py-2.5 rounded-lg border border-white/[0.1] text-[#fafafa] text-sm font-semibold hover:border-white/[0.2] transition-colors inline-flex items-center gap-2"
              style={font.display}
            >
              <Star size={14} /> Star on GitHub
            </a>
          </div>

          <span className="text-xs text-[#71717a]" style={font.mono}>
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
    <footer
      className="px-5 py-12 border-t border-white/[0.08]"
      style={{ background: "rgba(24,24,27,0.5)" }}
    >
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
              <span className="w-1.5 h-1.5 rounded-full bg-[#7c3aed] inline-block mb-2" />
            </div>
            <p
              className="text-sm text-[#71717a] leading-relaxed"
              style={font.body}
            >
              Self-hosted PaaS for teams that ship.
            </p>
            <div className="flex items-center gap-3 mt-4">
              <a
                href="#"
                className="text-[#71717a] hover:text-[#fafafa] transition-colors"
              >
                <Github size={16} />
              </a>
              <a
                href="#"
                className="text-[#71717a] hover:text-[#fafafa] transition-colors"
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
                    v.to === "/11"
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
        <div className="mt-10 pt-6 border-t border-white/[0.08] flex flex-wrap items-center justify-between gap-4">
          <span className="text-xs text-[#71717a]" style={font.mono}>
            &copy; 2026 otterdeploy
          </span>
          <span className="text-xs text-[#71717a]" style={font.mono}>
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
    <div
      className="min-h-screen text-[#fafafa]"
      style={{ background: "#09090b", ...font.body }}
    >
      <Nav />
      <Hero />
      <StatsBar />
      <EverythingSection />
      <BentoGrid />
      <FeatureTabs />
      <CommunitySection />
      <StatsRow />
      <TwoColumns />
      <PricingGrid />
      <CTA />
      <Footer />
    </div>
  );
}
