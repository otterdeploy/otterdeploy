import { createFileRoute, Link } from "@tanstack/react-router";
import { motion, useInView } from "motion/react";
import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  RefreshCw,
  Check,
  X,
  Copy,
  Github,
  Terminal,
  Shield,
  Server,
  Database,
  Lock,
  Eye,
  Rocket,
  Maximize,
  Twitter,
  DollarSign,
  Unlock,
  Zap,
  Settings,
  Box,
} from "lucide-react";

export const Route = createFileRoute("/9")({
  component: RouteComponent,
});

// ---------------------------------------------------------------------------
// Font Loader
// ---------------------------------------------------------------------------

function useFonts() {
  useEffect(() => {
    const id = "migration-page-fonts";
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

const MIGRATE_LINES = [
  { text: "$ otter migrate --from heroku --app my-production-app", type: "command" as const, delay: 0 },
  { text: "", type: "blank" as const, delay: 0.3 },
  { text: "\u2192 Analyzing Heroku app...", type: "header" as const, delay: 0.5 },
  { text: "  \u2713 Detected: Node.js web dyno", type: "success" as const, delay: 0.9 },
  { text: "  \u2713 Detected: PostgreSQL addon (Hobby Dev)", type: "success" as const, delay: 1.2 },
  { text: "  \u2713 Detected: Redis addon (Premium 0)", type: "success" as const, delay: 1.5 },
  { text: "  \u2713 Detected: 8 config vars", type: "success" as const, delay: 1.8 },
  { text: "", type: "blank" as const, delay: 2.0 },
  { text: "\u2192 Generating otterdeploy.yml...", type: "header" as const, delay: 2.2 },
  { text: "  \u2713 Service: web (from web dyno)", type: "success" as const, delay: 2.5 },
  { text: "  \u2713 Database: postgres (from heroku-postgresql)", type: "success" as const, delay: 2.8 },
  { text: "  \u2713 Cache: redis (from heroku-redis)", type: "success" as const, delay: 3.1 },
  { text: "  \u2713 Secrets: 8 variables migrated", type: "success" as const, delay: 3.4 },
  { text: "", type: "blank" as const, delay: 3.6 },
  { text: "\u2192 Ready to deploy!", type: "header" as const, delay: 3.8 },
  { text: "  $ otter deploy --env production", type: "command" as const, delay: 4.1 },
  { text: "", type: "blank" as const, delay: 4.3 },
  { text: "Migration complete. Welcome to Otterdeploy.", type: "final" as const, delay: 4.5 },
];

const TAB_DATA = {
  migrate: {
    label: "OTTER MIGRATE",
    heading: "Import from any platform",
    bullets: [
      "Auto-detect services and addons",
      "Convert config vars to secrets",
      "Map dynos to containers",
      "Preserve database connections",
    ],
    code: `$ otter migrate --from heroku --app my-app

\u2192 Analyzing Heroku app...
  \u2713 Detected: Node.js web dyno
  \u2713 Detected: PostgreSQL addon
  \u2713 Detected: 12 config vars

\u2192 Generating otterdeploy.yml...
  \u2713 Migration complete`,
  },
  config: {
    label: "OTTER CONFIG",
    heading: "Declarative infrastructure",
    bullets: [
      "Single file for entire stack",
      "Environment variables & secrets",
      "Volume mounts & persistence",
      "Resource linking & dependencies",
    ],
    code: `# otterdeploy.yml
name: my-app

services:
  web:
    build: ./app
    port: 3000
    replicas: 2
  api:
    build: ./server
    port: 8080

databases:
  postgres:
    version: "16"
  redis:
    version: "7"`,
  },
  deploy: {
    label: "OTTER DEPLOY",
    heading: "Push to production",
    bullets: [
      "Automatic builds on push",
      "Zero-downtime deploys",
      "Instant rollback support",
      "Branch preview environments",
    ],
    code: `$ otter deploy --env production

\u25b8 Building services...
  \u2713 web        Built in 8s
  \u2713 api        Built in 5s
  \u2713 worker     Built in 3s

\u25b8 Deploying...
  \u2713 web        \u2192 myapp.com
  \u2713 api        \u2192 api.myapp.com

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
      style={{ background: dark ? "#111111" : "#fafafa" }}
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
            className="text-[#0a0a0a] text-lg font-bold tracking-tight"
            style={font.display}
          >
            otterdeploy
          </span>
          <span className="w-1.5 h-1.5 rounded-full bg-[#7c3aed] inline-block mb-2" />
        </div>

        <div className="hidden md:flex items-center gap-6">
          {["Features", "Compare", "Pricing"].map((label) => (
            <a
              key={label}
              href={`#${label.toLowerCase()}`}
              className="text-sm text-[#666666] hover:text-[#0a0a0a] transition-colors"
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
                  v.to === "/9"
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
            className="px-4 py-1.5 text-sm font-semibold rounded-lg bg-[#0a0a0a] text-white hover:bg-[#262626] transition-colors"
            style={font.display}
          >
            Migrate Now
          </a>
        </div>
      </div>
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Isometric Grid (Hero Visual) — Migration variant
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
  { label: ".HEROKU", x: -110, y: -40, strike: true },
  { label: ".RAILWAY", x: 230, y: -50, strike: false },
  { label: ".RENDER", x: 250, y: 120, strike: false },
  { label: ".DOCKER", x: -120, y: 80, strike: false },
  { label: ".K8S", x: -100, y: 180, strike: false },
];

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
            <span
              className={`text-[10px] font-medium ${node.strike ? "text-[#999999] line-through" : "text-[#7c3aed]"}`}
            >
              {node.label}
            </span>
            {node.strike && (
              <span className="ml-1.5 text-[10px] text-[#7c3aed]">
                <ArrowRight size={10} className="inline" />
              </span>
            )}
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
              stroke={node.strike ? "#999999" : "#e5e5e5"}
              strokeWidth="1"
              strokeDasharray={node.strike ? "4 4" : "0"}
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
// Hero — Migration Angle
// ---------------------------------------------------------------------------

function Hero() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true });

  return (
    <section ref={ref} className="pt-28 pb-16 px-5 bg-white">
      <div className="max-w-5xl mx-auto text-center">
        <motion.div
          className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-[#e5e5e5] bg-[#f8f8f8] mb-6"
          initial={{ opacity: 0, y: 10 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ ...ease, delay: 0.05 }}
        >
          <RefreshCw size={14} className="text-[#7c3aed]" />
          <span className="text-xs text-[#666666] font-medium" style={font.body}>
            Migrate in minutes
          </span>
        </motion.div>

        <motion.h1
          className="text-5xl md:text-7xl font-bold text-[#0a0a0a] leading-[1.1] tracking-tight"
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
          className="mt-6 text-lg text-[#666666] max-w-2xl mx-auto leading-relaxed"
          style={{ ...font.body, fontWeight: 400 }}
          initial={{ opacity: 0, y: 15 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ ...ease, delay: 0.25 }}
        >
          Everything you love about Heroku, Railway, and Render — self-hosted,
          open source, and under your control.
        </motion.p>

        <motion.div
          className="mt-8 flex items-center justify-center gap-3"
          initial={{ opacity: 0, y: 10 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ ...ease, delay: 0.4 }}
        >
          <a
            href="#cta"
            className="px-6 py-2.5 text-sm font-semibold rounded-lg bg-[#0a0a0a] text-white hover:bg-[#262626] transition-colors inline-flex items-center gap-2"
            style={font.display}
          >
            Migrate now <ArrowRight size={16} />
          </a>
          <a
            href="#compare"
            className="px-6 py-2.5 text-sm font-semibold rounded-lg border border-[#e5e5e5] text-[#0a0a0a] hover:border-[#d4d4d4] transition-colors"
            style={font.display}
          >
            Compare platforms
          </a>
        </motion.div>

        <IsometricDiagram />
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Everything You Love Section
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
            Everything you love, nothing you don't
          </h2>
          <p
            className="mt-2 text-xl font-semibold text-[#0a0a0a]"
            style={font.display}
          >
            — no vendor lock-in, no surprise bills.
          </p>
          <p
            className="mt-4 text-base text-[#666666] max-w-xl leading-relaxed"
            style={font.body}
          >
            Same great developer experience. Your servers. Your data. Your rules.
          </p>
        </motion.div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Dark Terminal — Migration Workflow
// ---------------------------------------------------------------------------

function DarkTerminalSection() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-60px" });
  const [visibleLines, setVisibleLines] = useState(0);

  useEffect(() => {
    if (!inView) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    MIGRATE_LINES.forEach((line, i) => {
      timers.push(setTimeout(() => setVisibleLines(i + 1), line.delay * 1000));
    });
    return () => timers.forEach(clearTimeout);
  }, [inView]);

  return (
    <section
      ref={ref}
      className="py-24 px-5"
      style={{
        background: `radial-gradient(ellipse at 50% 0%, rgba(124,58,237,0.2) 0%, transparent 60%),
                     radial-gradient(ellipse at 60% 40%, rgba(167,139,250,0.1) 0%, transparent 50%),
                     #0a0a0a`,
      }}
    >
      <div className="max-w-3xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={ease}
        >
          <TerminalWindow title="Terminal — otter migrate">
            <div className="text-sm leading-relaxed min-h-[340px]">
              {MIGRATE_LINES.slice(0, visibleLines).map((line, i) => (
                <div key={i} className="whitespace-pre">
                  {line.type === "command" && (
                    <span className="text-[#fafafa]">{line.text}</span>
                  )}
                  {line.type === "blank" && <br />}
                  {line.type === "header" && (
                    <span className="text-[#a78bfa]">{line.text}</span>
                  )}
                  {line.type === "success" && (
                    <span>
                      <span className="text-[#4ade80]">
                        {line.text.slice(0, 3)}
                      </span>
                      <span className="text-[#fafafa]">
                        {line.text.slice(3)}
                      </span>
                    </span>
                  )}
                  {line.type === "final" && (
                    <span className="text-[#4ade80] font-medium">
                      {line.text}
                    </span>
                  )}
                </div>
              ))}
              {visibleLines < MIGRATE_LINES.length && inView && (
                <span className="inline-block w-2 h-4 bg-[#7c3aed] animate-pulse" />
              )}
            </div>
          </TerminalWindow>
        </motion.div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Comparison Table
// ---------------------------------------------------------------------------

const COMPARISON_ROWS = [
  { feature: "Self-hosted", heroku: false, railway: false, render: false, otter: true },
  { feature: "Open source", heroku: false, railway: false, render: false, otter: true },
  { feature: "Declarative config", heroku: false, railway: "Partial", render: "Partial", otter: true },
  { feature: "Multi-environment", heroku: "Limited", railway: true, render: true, otter: true },
  { feature: "RBAC", heroku: "Limited", railway: "Limited", render: "Limited", otter: true },
  { feature: "Secrets management", heroku: "Basic", railway: "Basic", render: "Basic", otter: "Advanced" },
  { feature: "Free tier", heroku: "Limited", railway: "Limited", render: "Limited", otter: "Unlimited" },
  { feature: "Vendor lock-in", heroku: "High", railway: "Medium", render: "Medium", otter: "None" },
];

function CellValue({ value }: { value: boolean | string }) {
  if (value === true) {
    return <Check size={16} className="text-[#4ade80] mx-auto" />;
  }
  if (value === false) {
    return <X size={16} className="text-[#999999] mx-auto" />;
  }
  return (
    <span className="text-sm text-[#666666]" style={font.body}>
      {value}
    </span>
  );
}

function ComparisonTable() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });

  return (
    <section
      id="compare"
      ref={ref}
      className="py-24 px-5 bg-white border-t border-[#e5e5e5]"
    >
      <div className="max-w-4xl mx-auto">
        <motion.h2
          className="text-4xl font-bold text-[#0a0a0a] tracking-tight mb-10 text-center"
          style={font.display}
          initial={{ opacity: 0, y: 15 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={ease}
        >
          How we compare
        </motion.h2>

        <motion.div
          className="overflow-x-auto rounded-xl border border-[#e5e5e5]"
          initial={{ opacity: 0, y: 20 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ ...ease, delay: 0.1 }}
        >
          <table className="w-full text-sm" style={font.body}>
            <thead>
              <tr className="border-b border-[#e5e5e5]">
                <th
                  className="text-left px-5 py-4 text-[#0a0a0a] font-semibold"
                  style={font.display}
                >
                  Feature
                </th>
                <th className="px-4 py-4 text-center text-[#666666] font-medium">
                  Heroku
                </th>
                <th className="px-4 py-4 text-center text-[#666666] font-medium">
                  Railway
                </th>
                <th className="px-4 py-4 text-center text-[#666666] font-medium">
                  Render
                </th>
                <th
                  className="px-4 py-4 text-center text-white font-semibold rounded-tr-xl"
                  style={{ background: "#7c3aed" }}
                >
                  Otterdeploy
                </th>
              </tr>
            </thead>
            <tbody>
              {COMPARISON_ROWS.map((row, i) => (
                <tr
                  key={row.feature}
                  className={`border-b border-[#e5e5e5] last:border-b-0 ${i % 2 === 0 ? "bg-white" : "bg-[#f8f8f8]"}`}
                >
                  <td className="px-5 py-3.5 text-[#0a0a0a] font-medium">
                    {row.feature}
                  </td>
                  <td className="px-4 py-3.5 text-center">
                    <CellValue value={row.heroku} />
                  </td>
                  <td className="px-4 py-3.5 text-center">
                    <CellValue value={row.railway} />
                  </td>
                  <td className="px-4 py-3.5 text-center">
                    <CellValue value={row.render} />
                  </td>
                  <td className="px-4 py-3.5 text-center bg-[#f3f0ff]">
                    <CellValue value={row.otter} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </motion.div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Bento Grid — Migration Benefits
// ---------------------------------------------------------------------------

function BentoGrid() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });

  return (
    <section
      id="features"
      ref={ref}
      className="py-24 px-5 bg-[#f8f8f8] border-t border-[#e5e5e5]"
    >
      <div className="max-w-5xl mx-auto">
        <motion.h2
          className="text-4xl font-bold text-[#0a0a0a] tracking-tight mb-10"
          style={font.display}
          initial={{ opacity: 0, y: 15 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={ease}
        >
          Why teams switch
        </motion.h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {/* Data Sovereignty — 2 cols */}
          <motion.div
            className="md:col-span-2 rounded-xl border border-[#e5e5e5] bg-white p-6 hover:border-[#7c3aed]/30 transition-colors"
            initial={{ opacity: 0, scale: 0.97 }}
            animate={inView ? { opacity: 1, scale: 1 } : {}}
            transition={{ ...ease, delay: 0.05 }}
          >
            <div className="flex items-center gap-2 mb-2">
              <Shield size={18} className="text-[#7c3aed]" />
              <h3
                className="text-base font-semibold text-[#0a0a0a]"
                style={font.display}
              >
                Data Sovereignty
              </h3>
            </div>
            <p
              className="text-sm text-[#666666] mb-4 leading-relaxed"
              style={font.body}
            >
              Your servers, your data. Everything runs on infrastructure you
              control. No third-party access, no data residency surprises,
              full compliance.
            </p>
            <div className="flex items-center gap-3 flex-wrap">
              {["Your VPC", "Your Region", "Your Rules"].map((s, i) => (
                <div key={s} className="flex items-center gap-2">
                  <div
                    className="px-3 py-2 rounded-md border border-[#e5e5e5] bg-[#f8f8f8] text-xs"
                    style={font.mono}
                  >
                    <span className="text-[#0a0a0a]">{s}</span>
                  </div>
                  {i < 2 && (
                    <ArrowRight size={12} className="text-[#7c3aed]" />
                  )}
                </div>
              ))}
              <span
                className="ml-2 text-xs text-[#4ade80] flex items-center gap-1"
                style={font.mono}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-[#4ade80]" />
                secure
              </span>
            </div>
          </motion.div>

          {/* No Surprise Bills — 1x1 */}
          <motion.div
            className="rounded-xl border border-[#e5e5e5] bg-white p-6 hover:border-[#7c3aed]/30 transition-colors"
            initial={{ opacity: 0, scale: 0.97 }}
            animate={inView ? { opacity: 1, scale: 1 } : {}}
            transition={{ ...ease, delay: 0.1 }}
          >
            <div className="flex items-center gap-2 mb-2">
              <DollarSign size={18} className="text-[#7c3aed]" />
              <h3
                className="text-base font-semibold text-[#0a0a0a]"
                style={font.display}
              >
                No Surprise Bills
              </h3>
            </div>
            <p
              className="text-sm text-[#666666] mb-4 leading-relaxed"
              style={font.body}
            >
              Predictable costs. Pay for your servers, not per-dyno pricing.
              Self-hosting means you control the economics.
            </p>
            <div className="flex justify-center py-2">
              <DollarSign size={36} className="text-[#7c3aed]/30" />
            </div>
          </motion.div>

          {/* Zero Lock-in — 1x1 */}
          <motion.div
            className="rounded-xl border border-[#e5e5e5] bg-white p-6 hover:border-[#7c3aed]/30 transition-colors"
            initial={{ opacity: 0, scale: 0.97 }}
            animate={inView ? { opacity: 1, scale: 1 } : {}}
            transition={{ ...ease, delay: 0.15 }}
          >
            <div className="flex items-center gap-2 mb-2">
              <Unlock size={18} className="text-[#7c3aed]" />
              <h3
                className="text-base font-semibold text-[#0a0a0a]"
                style={font.display}
              >
                Zero Lock-in
              </h3>
            </div>
            <p
              className="text-sm text-[#666666] mb-4 leading-relaxed"
              style={font.body}
            >
              Standard Docker, standard config. Take your infrastructure
              anywhere.
            </p>
            <div className="flex flex-wrap gap-2">
              {["Docker", "OCI", "YAML"].map((badge) => (
                <span
                  key={badge}
                  className="px-3 py-1 rounded-md text-xs font-medium bg-[#f3f0ff] text-[#7c3aed] border border-[#7c3aed]/20"
                >
                  {badge}
                </span>
              ))}
            </div>
          </motion.div>

          {/* Easy Migration — 2 cols */}
          <motion.div
            className="md:col-span-2 rounded-xl border border-[#e5e5e5] bg-white p-6 hover:border-[#7c3aed]/30 transition-colors"
            initial={{ opacity: 0, scale: 0.97 }}
            animate={inView ? { opacity: 1, scale: 1 } : {}}
            transition={{ ...ease, delay: 0.2 }}
          >
            <div className="flex items-center gap-2 mb-2">
              <Zap size={18} className="text-[#7c3aed]" />
              <h3
                className="text-base font-semibold text-[#0a0a0a]"
                style={font.display}
              >
                Easy Migration
              </h3>
            </div>
            <p
              className="text-sm text-[#666666] mb-4 leading-relaxed"
              style={font.body}
            >
              One command to migrate your entire app. Auto-detects services,
              databases, addons, and environment variables.
            </p>
            <div
              className="rounded-lg bg-[#0a0a0a] p-3 text-[11px] leading-relaxed text-[#4ade80]"
              style={font.mono}
            >
              <div className="text-[#fafafa]">$ otter migrate --from heroku</div>
              <div className="text-[#a78bfa] mt-1">{"\u2192"} Analyzing app...</div>
              <div className="text-[#4ade80]">{"\u2713"} Migration complete (3m 12s)</div>
            </div>
          </motion.div>

          {/* Better DX — 1x1 */}
          <motion.div
            className="rounded-xl border border-[#e5e5e5] bg-white p-6 hover:border-[#7c3aed]/30 transition-colors"
            initial={{ opacity: 0, scale: 0.97 }}
            animate={inView ? { opacity: 1, scale: 1 } : {}}
            transition={{ ...ease, delay: 0.25 }}
          >
            <div className="flex items-center gap-2 mb-2">
              <Terminal size={18} className="text-[#7c3aed]" />
              <h3
                className="text-base font-semibold text-[#0a0a0a]"
                style={font.display}
              >
                Better DX
              </h3>
            </div>
            <p
              className="text-sm text-[#666666] leading-relaxed"
              style={font.body}
            >
              Same great experience you already know. Git push deploys, preview
              environments, instant rollbacks. All open source.
            </p>
          </motion.div>

          {/* Full Control — 1x1 */}
          <motion.div
            className="rounded-xl border border-[#e5e5e5] bg-white p-6 hover:border-[#7c3aed]/30 transition-colors"
            initial={{ opacity: 0, scale: 0.97 }}
            animate={inView ? { opacity: 1, scale: 1 } : {}}
            transition={{ ...ease, delay: 0.3 }}
          >
            <div className="flex items-center gap-2 mb-2">
              <Settings size={18} className="text-[#7c3aed]" />
              <h3
                className="text-base font-semibold text-[#0a0a0a]"
                style={font.display}
              >
                Full Control
              </h3>
            </div>
            <p
              className="text-sm text-[#666666] leading-relaxed"
              style={font.body}
            >
              Customize everything. From build pipelines to networking rules,
              you have full access to every layer of the stack.
            </p>
          </motion.div>
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
    migrate: <RefreshCw size={16} />,
    config: <Box size={16} />,
    deploy: <Rocket size={16} />,
    monitor: <Eye size={16} />,
  };

  const data = TAB_DATA[activeTab];

  return (
    <section
      ref={ref}
      className="py-24 px-5"
      style={{
        background: `radial-gradient(ellipse at 50% 20%, rgba(124,58,237,0.2) 0%, transparent 60%),
                     radial-gradient(ellipse at 30% 70%, rgba(167,139,250,0.1) 0%, transparent 50%),
                     #0a0a0a`,
      }}
    >
      <div className="max-w-6xl mx-auto">
        <motion.h2
          className="text-3xl md:text-4xl font-bold text-[#fafafa] text-center tracking-tight mb-10"
          style={font.display}
          initial={{ opacity: 0, y: 15 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={ease}
        >
          Familiar workflows, zero compromises
        </motion.h2>

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
                if (line.startsWith("$") || line.startsWith("\u25b8")) {
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
                if (line.startsWith("\u2192")) {
                  return (
                    <div key={i} className="text-[#a78bfa]">{line}</div>
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
// Stats Row — Migration Focused
// ---------------------------------------------------------------------------

const STATS = [
  { value: "3min", label: "avg migration" },
  { value: "1", label: "command to migrate" },
  { value: "100%", label: "data ownership" },
  { value: "\u221e", label: "customization" },
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
// Two-Column — What You Gain / What You Keep
// ---------------------------------------------------------------------------

function TwoColumns() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });

  const gainBullets = [
    "Data ownership & sovereignty",
    "Cost savings & predictable billing",
    "Full customization of every layer",
    "No rate limits or platform quotas",
    "Open source & community driven",
  ];

  const keepBullets = [
    "Git push deploys",
    "Instant rollbacks",
    "Preview environments",
    "Managed databases",
    "Auto-scaling",
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
            What you gain
          </h3>
          <ul className="flex flex-col gap-3">
            {gainBullets.map((b) => (
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
            What you keep
          </h3>
          <ul className="flex flex-col gap-3">
            {keepBullets.map((b) => (
              <li key={b} className="flex items-start gap-3">
                <Check size={16} className="text-[#7c3aed] mt-0.5 shrink-0" />
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
              className="text-3xl font-bold text-[#0a0a0a] mb-3"
              style={font.display}
            >
              Pricing
            </h2>
            <p
              className="text-sm text-[#666666] leading-relaxed"
              style={font.body}
            >
              Self-hosted and open source. Migrate for free, pay only for the
              support and features your team needs.
            </p>
          </motion.div>

          {/* Community — Free for migration */}
          <motion.div
            className="p-8 border-b md:border-b-0 border-[#e5e5e5] bg-[#f3f0ff]"
            initial={{ opacity: 0, y: 15 }}
            animate={inView ? { opacity: 1, y: 0 } : {}}
            transition={{ ...ease, delay: 0.1 }}
          >
            <span
              className="text-xs text-[#7c3aed] uppercase tracking-wider font-medium"
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
              All core features, unlimited deploys, migration tools included.
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
// CTA — Migration Focused
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
                     #0a0a0a`,
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
          Ready to break free?
        </motion.h2>

        <motion.p
          className="mt-4 text-[#999999] text-lg"
          style={font.body}
          initial={{ opacity: 0, y: 15 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ ...ease, delay: 0.1 }}
        >
          One command. Full migration. Zero lock-in.
        </motion.p>

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
              $ {migrateCmd}
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
              Start migrating <ArrowRight size={16} />
            </a>
            <a
              href="#compare"
              className="px-6 py-2.5 rounded-lg border border-[#404040] text-[#fafafa] text-sm font-semibold hover:border-[#525252] transition-colors inline-flex items-center gap-2"
              style={font.display}
            >
              Compare platforms
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
              className="text-sm text-[#666666] leading-relaxed"
              style={font.body}
            >
              Self-hosted PaaS for teams that ship.
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
                    v.to === "/9"
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

          {/* Link columns */}
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

        {/* Bottom */}
        <div className="mt-10 pt-6 border-t border-[#262626] flex flex-wrap items-center justify-between gap-4">
          <span className="text-xs text-[#666666]" style={font.mono}>
            &copy; 2026 otterdeploy
          </span>
          <span className="text-xs text-[#666666]" style={font.mono}>
            break free from vendor lock-in
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
      <ComparisonTable />
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
