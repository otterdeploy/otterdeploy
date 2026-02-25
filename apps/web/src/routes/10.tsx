import { createFileRoute, Link } from "@tanstack/react-router";
import { motion, useInView } from "motion/react";
import { useEffect, useRef, useState } from "react";
import {
  Github,
  ArrowRight,
  Copy,
  Check,
  Terminal,
  Users,
  Shield,
  Code2,
  GitFork,
  Puzzle,
  Container,
  FileText,
  Heart,
  MessageCircle,
  Star,
} from "lucide-react";

export const Route = createFileRoute("/10")({
  component: RouteComponent,
});

// ---------------------------------------------------------------------------
// Font Loader
// ---------------------------------------------------------------------------

function useFonts() {
  useEffect(() => {
    const id = "oss-community-fonts";
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

const TERMINAL_LINES = [
  { text: "$ git clone https://github.com/otterdeploy/otterdeploy", type: "command" as const, delay: 0 },
  { text: "Cloning into 'otterdeploy'...", type: "info" as const, delay: 0.4 },
  { text: "\u2713 847 commits, 42 contributors", type: "success" as const, delay: 0.8 },
  { text: "", type: "blank" as const, delay: 1.1 },
  { text: "$ docker compose up -d", type: "command" as const, delay: 1.3 },
  { text: "\u2713 otterdeploy-api     Running (port 8080)", type: "success" as const, delay: 1.7 },
  { text: "\u2713 otterdeploy-web     Running (port 3000)", type: "success" as const, delay: 2.0 },
  { text: "\u2713 postgres            Running (port 5432)", type: "success" as const, delay: 2.3 },
  { text: "\u2713 redis               Running (port 6379)", type: "success" as const, delay: 2.6 },
  { text: "", type: "blank" as const, delay: 2.8 },
  { text: "Platform ready at http://localhost:3000", type: "final" as const, delay: 3.0 },
  { text: "", type: "blank" as const, delay: 3.3 },
  { text: "$ otter version", type: "command" as const, delay: 3.5 },
  { text: "otterdeploy v2.4.0 (MIT License)", type: "info" as const, delay: 3.8 },
  { text: "Built with \u2764 by the community", type: "heart" as const, delay: 4.1 },
];

const FEATURE_TABS = {
  install: {
    label: "INSTALL",
    heading: "Clone and run",
    bullets: [
      "One command to clone",
      "Docker Compose for all services",
      "Works on any Linux server",
      "No vendor dependencies",
    ],
    code: `$ git clone https://github.com/otterdeploy/otterdeploy
Cloning into 'otterdeploy'...
\u2713 Done.

$ cd otterdeploy && docker compose up -d
Creating network "otterdeploy_default"...
\u2713 otterdeploy-api     Running
\u2713 otterdeploy-web     Running
\u2713 postgres            Running
\u2713 redis               Running

\u2713 Platform ready at http://localhost:3000`,
  },
  configure: {
    label: "CONFIGURE",
    heading: "Declarative setup",
    bullets: [
      "Single YAML config file",
      "Environment variable management",
      "Domain and TLS configuration",
      "Resource limits and scaling rules",
    ],
    code: `# otterdeploy.yml
name: myapp
domain: myapp.com

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
    version: "7"`,
  },
  deploy: {
    label: "DEPLOY",
    heading: "Ship to production",
    bullets: [
      "Zero-downtime deployments",
      "Automatic health checks",
      "Instant rollback support",
      "Deploy previews per branch",
    ],
    code: `$ otter deploy --env production

\u25b8 Building services...
  \u2713 web        Built in 8s
  \u2713 api        Built in 5s

\u25b8 Deploying...
  \u2713 web        \u2192 myapp.com
  \u2713 api        \u2192 api.myapp.com
  \u2713 postgres   Connected
  \u2713 redis      Connected

\u2713 Deploy complete! (18s)`,
  },
  contribute: {
    label: "CONTRIBUTE",
    heading: "Join the effort",
    bullets: [
      "Fork the repository",
      "Run the test suite locally",
      "Submit pull requests",
      "Review and discuss with maintainers",
    ],
    code: `$ gh repo fork otterdeploy/otterdeploy
\u2713 Forked to yourname/otterdeploy

$ git checkout -b feat/my-feature
Switched to a new branch 'feat/my-feature'

$ make test
\u25b8 Running 248 tests...
\u2713 All tests passed (4.2s)

$ gh pr create --title "Add feature X"
\u2713 Pull request #849 created
  https://github.com/otterdeploy/otterdeploy/pull/849`,
  },
};

type TabKey = keyof typeof FEATURE_TABS;

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
  { label: ".GITHUB", x: -100, y: -40 },
  { label: ".DOCKER", x: 230, y: -50 },
  { label: ".MIT", x: 250, y: 80 },
  { label: ".CONTRIB", x: -110, y: 90 },
  { label: ".DOCS", x: 70, y: 200 },
];

const CONTRIBUTOR_INITIALS = ["JK", "SM", "AH", "RL", "TP", "NW", "DG", "MC", "LZ", "YB", "EF", "OQ"];

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
            Community
          </a>
        </div>

        <div className="flex items-center gap-2">
          <div className="hidden sm:flex items-center gap-1 mr-2">
            {VARIANT_LINKS.map((v) => (
              <Link
                key={v.to}
                to={v.to}
                className={`w-7 h-7 flex items-center justify-center text-xs rounded transition-colors ${
                  v.to === "/10"
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
            className="px-4 py-1.5 text-sm font-semibold rounded-lg bg-[#0a0a0a] text-white hover:bg-[#262626] transition-colors inline-flex items-center gap-2"
            style={font.display}
          >
            <Github size={14} /> Star on GitHub
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

  return (
    <section ref={ref} className="pt-28 pb-16 px-5 bg-white">
      <div className="max-w-5xl mx-auto text-center">
        <motion.div
          className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-[#f3f0ff] mb-8"
          initial={{ opacity: 0, y: 10 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ ...ease, delay: 0.05 }}
        >
          <Github size={16} className="text-[#7c3aed]" />
          <span className="text-sm text-[#7c3aed] font-medium" style={font.body}>
            Open Source &middot; MIT Licensed
          </span>
        </motion.div>

        <motion.h1
          className="text-5xl md:text-7xl font-extrabold text-[#0a0a0a] leading-[1.1] tracking-tight"
          style={font.display}
          initial={{ opacity: 0, y: 20 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ ...ease, delay: 0.1 }}
        >
          Infrastructure,
          <br />
          by the{" "}
          <span className="text-[#7c3aed]">Community</span>
        </motion.h1>

        <motion.p
          className="mt-6 text-lg text-[#666666] max-w-2xl mx-auto leading-relaxed"
          style={{ ...font.body, fontWeight: 400 }}
          initial={{ opacity: 0, y: 15 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ ...ease, delay: 0.25 }}
        >
          Fully open source, self-hosted, and community-driven. No vendor lock-in.
          No hidden costs. Just great infrastructure tooling.
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
            <Github size={16} /> Star on GitHub <Star size={14} />
          </a>
          <a
            href="#features"
            className="px-6 py-2.5 text-sm font-semibold rounded-lg border border-[#e5e5e5] text-[#0a0a0a] hover:border-[#d4d4d4] transition-colors"
            style={font.display}
          >
            Read the docs
          </a>
        </motion.div>

        <IsometricDiagram />
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Free as in Freedom
// ---------------------------------------------------------------------------

function FreedomSection() {
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
            Free as in freedom
          </h2>
          <p
            className="mt-2 text-xl font-semibold text-[#0a0a0a]"
            style={font.display}
          >
            — and free as in beer.
          </p>
          <p
            className="mt-4 text-base text-[#666666] max-w-xl leading-relaxed"
            style={font.body}
          >
            Otterdeploy is MIT licensed. Run it on your own servers, fork it,
            modify it, contribute back. The community owns the roadmap.
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
    TERMINAL_LINES.forEach((line, i) => {
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
          <TerminalWindow title="Terminal -- open source workflow">
            <div className="text-sm leading-relaxed min-h-[340px]">
              {TERMINAL_LINES.slice(0, visibleLines).map((line, i) => (
                <div key={i} className="whitespace-pre">
                  {line.type === "command" && (
                    <span className="text-[#fafafa]">{line.text}</span>
                  )}
                  {line.type === "blank" && <br />}
                  {line.type === "info" && (
                    <span className="text-[#999999]">{line.text}</span>
                  )}
                  {line.type === "success" && (
                    <span>
                      <span className="text-[#4ade80]">{line.text.slice(0, 1)}</span>
                      <span className="text-[#fafafa]">{line.text.slice(1)}</span>
                    </span>
                  )}
                  {line.type === "final" && (
                    <span className="text-[#4ade80] font-medium">{line.text}</span>
                  )}
                  {line.type === "heart" && (
                    <span className="text-[#a78bfa]">{line.text}</span>
                  )}
                </div>
              ))}
              {visibleLines < TERMINAL_LINES.length && inView && (
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
// Bento Grid -- Open Source Benefits
// ---------------------------------------------------------------------------

function BentoGrid() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });

  const licenseSnippet = `MIT License

Copyright (c) 2024 Otterdeploy

Permission is hereby granted, free
of charge, to any person obtaining
a copy of this software...`;

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
          Why open source matters
        </motion.h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {/* MIT Licensed -- col-span-2 */}
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
                MIT Licensed
              </h3>
              <span className="ml-auto px-2 py-0.5 rounded text-[10px] font-medium bg-[#f3f0ff] text-[#7c3aed]" style={font.mono}>
                MIT
              </span>
            </div>
            <p
              className="text-sm text-[#666666] mb-4 leading-relaxed"
              style={font.body}
            >
              Use it anywhere, for anything. No restrictions on commercial use,
              modification, or distribution. True software freedom.
            </p>
            <div
              className="rounded-lg border border-[#e5e5e5] bg-[#f8f8f8] p-4 text-xs leading-relaxed"
              style={font.mono}
            >
              {licenseSnippet.split("\n").map((line, i) => (
                <div key={i}>
                  <span className={i === 0 ? "text-[#7c3aed] font-medium" : "text-[#666666]"}>
                    {line || "\u00a0"}
                  </span>
                </div>
              ))}
            </div>
          </motion.div>

          {/* Self-Hosted -- 1x1 */}
          <motion.div
            className="rounded-xl border border-[#e5e5e5] bg-white p-6 hover:border-[#7c3aed]/30 transition-colors"
            initial={{ opacity: 0, scale: 0.97 }}
            animate={inView ? { opacity: 1, scale: 1 } : {}}
            transition={{ ...ease, delay: 0.1 }}
          >
            <div className="flex items-center gap-2 mb-2">
              <Container size={18} className="text-[#7c3aed]" />
              <h3
                className="text-base font-semibold text-[#0a0a0a]"
                style={font.display}
              >
                Self-Hosted
              </h3>
            </div>
            <p
              className="text-sm text-[#666666] leading-relaxed"
              style={font.body}
            >
              Your servers, your rules. Complete data sovereignty. Run on any
              cloud or bare metal. Your data never leaves your infrastructure.
            </p>
            <div className="mt-4 flex justify-center">
              <Container size={36} className="text-[#7c3aed]/30" />
            </div>
          </motion.div>

          {/* Community Driven -- 1x1 */}
          <motion.div
            className="rounded-xl border border-[#e5e5e5] bg-white p-6 hover:border-[#7c3aed]/30 transition-colors"
            initial={{ opacity: 0, scale: 0.97 }}
            animate={inView ? { opacity: 1, scale: 1 } : {}}
            transition={{ ...ease, delay: 0.15 }}
          >
            <div className="flex items-center gap-2 mb-2">
              <Users size={18} className="text-[#7c3aed]" />
              <h3
                className="text-base font-semibold text-[#0a0a0a]"
                style={font.display}
              >
                Community Driven
              </h3>
            </div>
            <p
              className="text-sm text-[#666666] mb-4 leading-relaxed"
              style={font.body}
            >
              42 contributors and growing. The community shapes the roadmap.
            </p>
            <div className="flex flex-wrap gap-1.5">
              {CONTRIBUTOR_INITIALS.slice(0, 8).map((initials, i) => (
                <div
                  key={i}
                  className="w-8 h-8 rounded-full bg-[#f3f0ff] border border-[#e5e5e5] flex items-center justify-center"
                >
                  <span className="text-[9px] font-medium text-[#7c3aed]" style={font.mono}>
                    {initials}
                  </span>
                </div>
              ))}
              <div className="w-8 h-8 rounded-full bg-[#7c3aed]/10 border border-[#7c3aed]/20 flex items-center justify-center">
                <span className="text-[9px] font-medium text-[#7c3aed]" style={font.mono}>
                  +34
                </span>
              </div>
            </div>
          </motion.div>

          {/* Transparent -- col-span-2 */}
          <motion.div
            className="md:col-span-2 rounded-xl border border-[#e5e5e5] bg-white p-6 hover:border-[#7c3aed]/30 transition-colors"
            initial={{ opacity: 0, scale: 0.97 }}
            animate={inView ? { opacity: 1, scale: 1 } : {}}
            transition={{ ...ease, delay: 0.2 }}
          >
            <div className="flex items-center gap-2 mb-2">
              <Code2 size={18} className="text-[#7c3aed]" />
              <h3
                className="text-base font-semibold text-[#0a0a0a]"
                style={font.display}
              >
                Transparent
              </h3>
            </div>
            <p
              className="text-sm text-[#666666] mb-4 leading-relaxed"
              style={font.body}
            >
              Every line of code is public. Audit the source, read the history,
              understand exactly what runs on your servers.
            </p>
            <div className="flex flex-wrap items-center gap-4">
              {[
                { value: "847", label: "commits" },
                { value: "42", label: "contributors" },
                { value: "2.4k", label: "stars" },
                { value: "18k", label: "weekly downloads" },
              ].map((stat) => (
                <div key={stat.label} className="flex items-center gap-1.5">
                  <span
                    className="text-sm font-bold text-[#7c3aed]"
                    style={font.display}
                  >
                    {stat.value}
                  </span>
                  <span className="text-xs text-[#999999]" style={font.mono}>
                    {stat.label}
                  </span>
                  <span className="text-[#e5e5e5] mx-1 last:hidden">&middot;</span>
                </div>
              ))}
            </div>
          </motion.div>

          {/* Extensible -- 1x1 */}
          <motion.div
            className="rounded-xl border border-[#e5e5e5] bg-white p-6 hover:border-[#7c3aed]/30 transition-colors"
            initial={{ opacity: 0, scale: 0.97 }}
            animate={inView ? { opacity: 1, scale: 1 } : {}}
            transition={{ ...ease, delay: 0.25 }}
          >
            <div className="flex items-center gap-2 mb-2">
              <Puzzle size={18} className="text-[#7c3aed]" />
              <h3
                className="text-base font-semibold text-[#0a0a0a]"
                style={font.display}
              >
                Extensible
              </h3>
            </div>
            <p
              className="text-sm text-[#666666] leading-relaxed"
              style={font.body}
            >
              Plugin architecture lets you extend every part of the platform.
              Build custom providers, integrations, and workflows.
            </p>
          </motion.div>

          {/* No Lock-in -- 1x1 */}
          <motion.div
            className="rounded-xl border border-[#e5e5e5] bg-white p-6 hover:border-[#7c3aed]/30 transition-colors"
            initial={{ opacity: 0, scale: 0.97 }}
            animate={inView ? { opacity: 1, scale: 1 } : {}}
            transition={{ ...ease, delay: 0.3 }}
          >
            <div className="flex items-center gap-2 mb-2">
              <GitFork size={18} className="text-[#7c3aed]" />
              <h3
                className="text-base font-semibold text-[#0a0a0a]"
                style={font.display}
              >
                No Lock-in
              </h3>
            </div>
            <p
              className="text-sm text-[#666666] mb-4 leading-relaxed"
              style={font.body}
            >
              Standard formats, standard tools. Migrate in or out at any time.
            </p>
            <div className="flex flex-wrap gap-2">
              {["Docker", "OCI", "YAML"].map((badge) => (
                <span
                  key={badge}
                  className="px-3 py-1 rounded-md text-xs font-medium bg-[#f8f8f8] text-[#666666] border border-[#e5e5e5]"
                  style={font.mono}
                >
                  {badge}
                </span>
              ))}
            </div>
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
  const [activeTab, setActiveTab] = useState<TabKey>("install");

  const tabIcons: Record<TabKey, React.ReactNode> = {
    install: <Terminal size={16} />,
    configure: <FileText size={16} />,
    deploy: <ArrowRight size={16} />,
    contribute: <GitFork size={16} />,
  };

  const data = FEATURE_TABS[activeTab];

  return (
    <section
      ref={ref}
      className="py-24 px-5"
      style={{
        background: `radial-gradient(ellipse at 50% 0%, rgba(124,58,237,0.18) 0%, transparent 60%),
                     radial-gradient(ellipse at 80% 60%, rgba(167,139,250,0.08) 0%, transparent 50%),
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
          From clone to production
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
                  return <div key={i} className="text-[#737373]">{line}</div>;
                }
                if (line.startsWith("$")) {
                  return <div key={i} className="text-[#fafafa]">{line}</div>;
                }
                if (line.startsWith("\u25b8")) {
                  return <div key={i} className="text-[#999999]">{line}</div>;
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
                          <span className="text-[#a78bfa]">
                            {line.split("\u2192")[1].trim()}
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
// Stats Row (Community-focused)
// ---------------------------------------------------------------------------

const STATS = [
  { value: "847", label: "commits" },
  { value: "42", label: "contributors" },
  { value: "2.4k", label: "GitHub stars" },
  { value: "MIT", label: "license" },
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

  const selfHostBullets = [
    "Data sovereignty -- your data never leaves your servers",
    "Compliance -- meet regulatory requirements on your terms",
    "Cost control -- predictable infrastructure spending",
    "Customization -- modify every aspect of the platform",
    "No rate limits -- unlimited deployments and builds",
  ];

  const contributeSteps = [
    "Fork the repository",
    "Create a feature branch",
    "Write your code and tests",
    "Run the test suite locally",
    "Open a pull request",
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
            Why self-host?
          </h3>
          <ul className="flex flex-col gap-3">
            {selfHostBullets.map((b) => (
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
            How to contribute
          </h3>
          <ul className="flex flex-col gap-3">
            {contributeSteps.map((b, i) => (
              <li key={b} className="flex items-start gap-3">
                <div className="flex items-center gap-2">
                  <span
                    className="w-6 h-6 rounded-full bg-[#f3f0ff] border border-[#e5e5e5] flex items-center justify-center shrink-0"
                  >
                    <Check size={12} className="text-[#7c3aed]" />
                  </span>
                </div>
                <span
                  className="text-sm text-[#666666] leading-relaxed pt-0.5"
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
// Pricing Grid (Open Source Emphasis)
// ---------------------------------------------------------------------------

function PricingGrid() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });

  return (
    <section
      ref={ref}
      className="py-24 px-5 bg-white border-t border-[#e5e5e5]"
    >
      <div className="max-w-5xl mx-auto">
        <motion.div
          className="text-center mb-10"
          initial={{ opacity: 0, y: 15 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={ease}
        >
          <h2
            className="text-3xl font-bold text-[#0a0a0a] tracking-tight"
            style={font.display}
          >
            Core platform is free forever
          </h2>
          <p
            className="mt-2 text-base text-[#666666]"
            style={font.body}
          >
            Enterprise features fund development. The open source core stays free.
          </p>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {/* Community */}
          <motion.div
            className="rounded-xl border-2 border-[#7c3aed] bg-white p-8"
            initial={{ opacity: 0, y: 15 }}
            animate={inView ? { opacity: 1, y: 0 } : {}}
            transition={{ ...ease, delay: 0.05 }}
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
            <p className="text-sm text-[#666666] mt-2 leading-relaxed" style={font.body}>
              All core features, unlimited deployments, unlimited services,
              community support via GitHub and Discord.
            </p>
            <div className="mt-4 flex flex-col gap-2">
              {["Unlimited deploys", "All service types", "Full CLI access", "Community support"].map((f) => (
                <div key={f} className="flex items-center gap-2">
                  <Check size={14} className="text-[#7c3aed]" />
                  <span className="text-xs text-[#666666]" style={font.body}>{f}</span>
                </div>
              ))}
            </div>
          </motion.div>

          {/* Sponsor */}
          <motion.div
            className="rounded-xl border border-[#e5e5e5] bg-white p-8 hover:border-[#7c3aed]/30 transition-colors"
            initial={{ opacity: 0, y: 15 }}
            animate={inView ? { opacity: 1, y: 0 } : {}}
            transition={{ ...ease, delay: 0.1 }}
          >
            <span
              className="text-xs text-[#999999] uppercase tracking-wider"
              style={font.mono}
            >
              Sponsor
            </span>
            <div className="mt-2">
              <span
                className="text-4xl font-bold text-[#0a0a0a]"
                style={font.display}
              >
                $19
              </span>
              <span className="text-sm text-[#999999] ml-1">/mo</span>
            </div>
            <p className="text-sm text-[#666666] mt-2 leading-relaxed" style={font.body}>
              Priority support, voting on the roadmap, and a sponsor badge in
              the community.
            </p>
            <div className="mt-4 flex flex-col gap-2">
              {["Everything in Community", "Priority support", "Roadmap voting", "Sponsor badge"].map((f) => (
                <div key={f} className="flex items-center gap-2">
                  <Check size={14} className="text-[#7c3aed]" />
                  <span className="text-xs text-[#666666]" style={font.body}>{f}</span>
                </div>
              ))}
            </div>
          </motion.div>

          {/* Enterprise */}
          <motion.div
            className="rounded-xl border border-[#e5e5e5] bg-white p-8 hover:border-[#7c3aed]/30 transition-colors"
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
              SLA guarantees, dedicated support engineer, custom integrations,
              and on-prem deployment assistance.
            </p>
            <div className="mt-4 flex flex-col gap-2">
              {["Everything in Sponsor", "SLA guarantee", "Dedicated support", "Custom integrations"].map((f) => (
                <div key={f} className="flex items-center gap-2">
                  <Check size={14} className="text-[#7c3aed]" />
                  <span className="text-xs text-[#666666]" style={font.body}>{f}</span>
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
// CTA (Dark with purple aurora)
// ---------------------------------------------------------------------------

function CTA() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-60px" });
  const [copied, setCopied] = useState(false);

  const cloneCmd = "git clone https://github.com/otterdeploy/otterdeploy";

  const handleCopy = () => {
    navigator.clipboard.writeText(cloneCmd);
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
          Join the community
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
              $ {cloneCmd}
            </span>
            {copied ? (
              <Check size={16} className="text-[#4ade80] shrink-0 ml-3" />
            ) : (
              <Copy
                size={16}
                className="text-[#737373] group-hover:text-[#999999] transition-colors shrink-0 ml-3"
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
              className="px-6 py-2.5 rounded-lg bg-[#0a0a0a] border border-[#404040] text-white text-sm font-semibold hover:border-[#525252] transition-colors inline-flex items-center gap-2"
              style={font.display}
            >
              <Github size={16} /> Star on GitHub <Star size={14} />
            </a>
            <a
              href="#"
              className="px-6 py-2.5 rounded-lg border border-[#404040] text-[#fafafa] text-sm font-semibold hover:border-[#525252] transition-colors inline-flex items-center gap-2"
              style={font.display}
            >
              <MessageCircle size={16} /> Join Discord
            </a>
          </div>

          <span className="text-xs text-[#737373]" style={font.mono}>
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
              className="text-sm text-[#737373] leading-relaxed"
              style={font.body}
            >
              Open source PaaS for teams that ship.
            </p>
            <div className="flex items-center gap-3 mt-4">
              <a href="#" className="text-[#737373] hover:text-[#999999] transition-colors">
                <Github size={16} />
              </a>
              <a href="#" className="text-[#737373] hover:text-[#999999] transition-colors">
                <MessageCircle size={16} />
              </a>
            </div>
            <div className="flex items-center gap-1 mt-4">
              {VARIANT_LINKS.map((v) => (
                <Link
                  key={v.to}
                  to={v.to}
                  className={`w-6 h-6 flex items-center justify-center text-xs rounded transition-colors ${
                    v.to === "/10"
                      ? "bg-[#7c3aed]/20 text-[#a78bfa]"
                      : "text-[#737373] hover:text-[#999999]"
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
                    className="text-sm text-[#999999] hover:text-[#fafafa] transition-colors"
                    style={{ ...font.body, fontWeight: 400 }}
                  >
                    {link}
                  </a>
                ))}
              </div>
            </div>
          ))}

          {/* Contributors section */}
          <div>
            <h5
              className="text-xs text-[#737373] uppercase tracking-wider mb-3"
              style={font.mono}
            >
              Contributors
            </h5>
            <div className="flex flex-wrap gap-1 mb-3">
              {CONTRIBUTOR_INITIALS.slice(0, 6).map((initials, i) => (
                <div
                  key={i}
                  className="w-6 h-6 rounded-full bg-[#7c3aed]/10 border border-[#262626] flex items-center justify-center"
                >
                  <span className="text-[7px] font-medium text-[#a78bfa]" style={font.mono}>
                    {initials}
                  </span>
                </div>
              ))}
            </div>
            <p className="text-sm text-[#999999]" style={font.body}>
              42 contributors
            </p>
            <a
              href="#"
              className="text-xs text-[#7c3aed] hover:text-[#a78bfa] transition-colors mt-1 inline-block"
              style={font.body}
            >
              View all contributors
            </a>
          </div>
        </div>

        {/* Bottom */}
        <div className="mt-10 pt-6 border-t border-[#262626] flex flex-wrap items-center justify-between gap-4">
          <span className="text-xs text-[#737373]" style={font.mono}>
            &copy; 2026 otterdeploy &middot; MIT License
          </span>
          <span className="text-xs text-[#737373] inline-flex items-center gap-1" style={font.mono}>
            built with <Heart size={10} className="text-[#7c3aed]" /> by the community
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
      <FreedomSection />
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
