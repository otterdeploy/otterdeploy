import { createFileRoute, Link } from "@tanstack/react-router";
import { motion, useInView } from "motion/react";
import { useEffect, useRef, useState } from "react";
import {
  Rocket,
  FileCode2,
  Monitor,
  Lock,
  Users,
  ScrollText,
  ArrowRight,
  Github,
  Twitter,
  Check,
  Zap,
  Shield,
  BarChart3,
} from "lucide-react";

export const Route = createFileRoute("/2")({
  component: RouteComponent,
});

/* ---------- constants ---------- */

const VARIANT_IDS = [1, 2, 3, 4, 5];

const FEATURE_CARDS = [
  {
    title: "Infrastructure as Code",
    desc: "Define everything in one file. Your entire stack — services, databases, caches, volumes — described declaratively.",
    badges: ["yaml", "toml", "json"],
  },
  {
    title: "Git-Driven Deploys",
    desc: "Push to deploy automatically. Every commit triggers a build, test, and deploy pipeline.",
    badges: ["GitHub", "GitLab"],
  },
  {
    title: "Drop-in Replacement",
    desc: "For your current deploy workflow. Migrate from Heroku, Railway, or Render in minutes, not weeks.",
    badges: ["Heroku", "Railway", "Render"],
  },
];

const TABS = [
  {
    id: "define",
    label: "define",
    icon: FileCode2,
    category: "OTTER DEFINE",
    heading: "Declarative infrastructure",
    bullets: [
      "Single config for entire stack",
      "Environment inheritance",
      "Type-safe schema validation",
      "Git-friendly diffable configs",
    ],
    terminal: [
      { text: "# otterdeploy.yml", color: "#666666" },
      { text: "", color: "" },
      { text: "name: my-app", color: "#a78bfa" },
      { text: "version: 2", color: "#e5e5e5" },
      { text: "", color: "" },
      { text: "services:", color: "#a78bfa" },
      { text: "  web:", color: "#22d3ee" },
      { text: "    build: ./Dockerfile", color: "#e5e5e5" },
      { text: "    port: 3000", color: "#e5e5e5" },
      { text: "    replicas: 3", color: "#e5e5e5" },
      { text: "    env:", color: "#22d3ee" },
      { text: '      NODE_ENV: "production"', color: "#e5e5e5" },
      { text: "", color: "" },
      { text: "  api:", color: "#22d3ee" },
      { text: "    build: ./api", color: "#e5e5e5" },
      { text: "    port: 8080", color: "#e5e5e5" },
      { text: "", color: "" },
      { text: "databases:", color: "#a78bfa" },
      { text: "  postgres:", color: "#22d3ee" },
      { text: "    image: postgres:16", color: "#e5e5e5" },
      { text: "    storage: 20Gi", color: "#e5e5e5" },
    ],
  },
  {
    id: "deploy",
    label: "deploy",
    icon: Rocket,
    category: "OTTER DEPLOY",
    heading: "Zero-downtime deploys",
    bullets: [
      "Automatic rollbacks on failure",
      "Blue-green deployments",
      "Git push to deploy",
      "Branch preview environments",
    ],
    terminal: [
      { text: "$ otter deploy --env production", color: "#e5e5e5" },
      { text: "", color: "" },
      { text: "otterdeploy v2.4.0 ready", color: "#a78bfa" },
      { text: "", color: "" },
      { text: "-> Building services...", color: "#e5e5e5" },
      { text: "   ✓ web        Built in 8s", color: "#4ade80" },
      { text: "   ✓ api        Built in 5s", color: "#4ade80" },
      { text: "   ✓ worker     Built in 3s", color: "#4ade80" },
      { text: "", color: "" },
      { text: "-> Deploying to production...", color: "#e5e5e5" },
      { text: "   ✓ web        → https://myapp.com", color: "#22d3ee" },
      { text: "   ✓ api        → https://api.myapp.com", color: "#22d3ee" },
      { text: "   ✓ postgres   Connected", color: "#4ade80" },
      { text: "   ✓ redis      Connected", color: "#4ade80" },
      { text: "", color: "" },
      { text: "Deploy complete! All services healthy.", color: "#4ade80" },
    ],
  },
  {
    id: "monitor",
    label: "monitor",
    icon: Monitor,
    category: "OTTER MONITOR",
    heading: "Real-time observability",
    bullets: [
      "Live health checks and metrics",
      "Request tracing across services",
      "Resource usage dashboards",
      "Alerts and incident management",
    ],
    terminal: [
      { text: "$ otter status --env production", color: "#e5e5e5" },
      { text: "", color: "" },
      { text: "Service      Status    Replicas  CPU    Memory", color: "#666666" },
      { text: "web          ● healthy  3/3      12%    256Mi", color: "#4ade80" },
      { text: "api          ● healthy  2/2       8%    128Mi", color: "#4ade80" },
      { text: "worker       ● healthy  1/1       4%     64Mi", color: "#4ade80" },
      { text: "postgres     ● healthy  1/1      15%    512Mi", color: "#4ade80" },
      { text: "redis        ● healthy  1/1       2%     32Mi", color: "#4ade80" },
      { text: "", color: "" },
      { text: "Uptime: 99.99%  |  Requests: 12.4k/min", color: "#a78bfa" },
      { text: "Avg Response: 42ms  |  Error Rate: 0.01%", color: "#a78bfa" },
    ],
  },
  {
    id: "secrets",
    label: "secrets",
    icon: Lock,
    category: "OTTER SECRETS",
    heading: "Encrypted secrets management",
    bullets: [
      "End-to-end encrypted at rest",
      "Per-environment secret scoping",
      "Rotate keys without redeploying",
      "Audit log for all access",
    ],
    terminal: [
      { text: "$ otter secrets set DATABASE_URL --env production", color: "#e5e5e5" },
      { text: "Enter value: ••••••••••••••••", color: "#666666" },
      { text: "", color: "" },
      { text: "✓ Secret DATABASE_URL encrypted and stored", color: "#4ade80" },
      { text: "  Scope: production", color: "#e5e5e5" },
      { text: "  Encrypted: AES-256-GCM", color: "#a78bfa" },
      { text: "", color: "" },
      { text: "$ otter secrets list --env production", color: "#e5e5e5" },
      { text: "", color: "" },
      { text: "Name             Updated          By", color: "#666666" },
      { text: "DATABASE_URL     2 minutes ago    jeff", color: "#e5e5e5" },
      { text: "REDIS_URL        3 days ago       jeff", color: "#e5e5e5" },
      { text: "API_KEY          1 week ago       sara", color: "#e5e5e5" },
    ],
  },
  {
    id: "teams",
    label: "teams",
    icon: Users,
    category: "OTTER TEAMS",
    heading: "Multi-tenancy and RBAC",
    bullets: [
      "Organizations and team workspaces",
      "Role-based access control",
      "SSO and SAML integration",
      "Audit trails for compliance",
    ],
    terminal: [
      { text: "$ otter teams list", color: "#e5e5e5" },
      { text: "", color: "" },
      { text: "Organization: Acme Corp", color: "#a78bfa" },
      { text: "", color: "" },
      { text: "Team         Members  Projects  Role", color: "#666666" },
      { text: "Engineering  12       8         admin", color: "#e5e5e5" },
      { text: "Platform     4        3         admin", color: "#e5e5e5" },
      { text: "Frontend     6        5         deploy", color: "#e5e5e5" },
      { text: "QA           3        8         read", color: "#e5e5e5" },
      { text: "", color: "" },
      { text: "✓ SSO enabled via Okta", color: "#4ade80" },
      { text: "✓ Audit logging active", color: "#4ade80" },
    ],
  },
  {
    id: "logs",
    label: "logs",
    icon: ScrollText,
    category: "OTTER LOGS",
    heading: "Centralized log streaming",
    bullets: [
      "Aggregated logs across services",
      "Full-text search and filtering",
      "Real-time tail and replay",
      "Export to external providers",
    ],
    terminal: [
      { text: "$ otter logs --service web --tail", color: "#e5e5e5" },
      { text: "", color: "" },
      { text: "[web-01] 10:42:01  GET  /api/users     200  12ms", color: "#4ade80" },
      { text: "[web-02] 10:42:01  POST /api/deploy    201  89ms", color: "#4ade80" },
      { text: "[web-01] 10:42:02  GET  /api/status    200   4ms", color: "#4ade80" },
      { text: "[web-03] 10:42:02  GET  /api/health    200   2ms", color: "#4ade80" },
      { text: "[web-01] 10:42:03  POST /api/webhook   200  34ms", color: "#4ade80" },
      { text: "[web-02] 10:42:03  GET  /dashboard     200  18ms", color: "#22d3ee" },
      { text: "", color: "" },
      { text: "Streaming from 3 replicas...", color: "#a78bfa" },
    ],
  },
];

const STATS = [
  { value: "4,200+", label: "Deployments", icon: Rocket },
  { value: "99.9%", label: "Uptime", icon: Shield },
  { value: "<30s", label: "Average build time", icon: Zap },
  { value: "\u221E", label: "Scalability", icon: BarChart3 },
];

const PRICING = [
  {
    tier: "COMMUNITY",
    name: "Free",
    desc: "For individuals and small projects. Full platform, no limits, forever.",
  },
  {
    tier: "TEAM",
    name: "Pro",
    desc: "For growing teams. Priority support, advanced RBAC, and SSO integration.",
  },
  {
    tier: "ENTERPRISE",
    name: "Custom",
    desc: "For organizations at scale. Dedicated support, SLAs, and custom integrations.",
  },
];

const FOOTER_COLS = [
  { title: "Product", links: ["Features", "Pricing", "Changelog", "Roadmap"] },
  { title: "Community", links: ["GitHub", "Discord", "Twitter", "Blog"] },
  { title: "Legal", links: ["Privacy", "Terms", "License", "Security"] },
];

const SHIPPING_BULLETS = [
  "Unified config for web, API, worker, database, cache, and volume resources",
  "Environment inheritance with per-env overrides",
  "Automated health checks and self-healing restarts",
  "Built-in metrics, logging, and tracing",
  "One-click rollback to any previous deploy",
];

const SECURITY_CHECKS = [
  "All dependencies audited",
  "SOC 2 compliant architecture",
  "End-to-end encryption",
  "Regular penetration testing",
];

/* ---------- style tokens ---------- */

const mono = "'JetBrains Mono', monospace";
const sans = "'Plus Jakarta Sans', sans-serif";
const ease: [number, number, number, number] = [0.25, 0.46, 0.45, 0.94];

const auroraGradient = `radial-gradient(ellipse at 50% 0%, rgba(124,58,237,0.3) 0%, transparent 60%),
  radial-gradient(ellipse at 30% 50%, rgba(59,130,246,0.2) 0%, transparent 50%),
  radial-gradient(ellipse at 70% 50%, rgba(139,92,246,0.15) 0%, transparent 50%),
  #0a0a0a`;

const fadeUp = {
  hidden: { opacity: 0, y: 24 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.6, delay: i * 0.1, ease },
  }),
};

/* ---------- main ---------- */

function RouteComponent() {
  useEffect(() => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href =
      "https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap";
    document.head.appendChild(link);
    return () => {
      document.head.removeChild(link);
    };
  }, []);

  return (
    <div
      className="min-h-screen"
      style={{ backgroundColor: "#ffffff", color: "#0a0a0a", fontFamily: sans }}
    >
      <NavBar />
      <HeroSection />
      <EverythingSection />
      <DarkTerminalSection />
      <FeatureCardsGrid />
      <FeatureTabsSection />
      <StatsSection />
      <TwoColumnFeatures />
      <PricingSection />
      <CTASection />
      <Footer />
    </div>
  );
}

/* ==================== NAV ==================== */

function NavBar() {
  return (
    <nav
      className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-6 md:px-12"
      style={{
        height: 64,
        backgroundColor: "rgba(255,255,255,0.9)",
        backdropFilter: "blur(20px)",
        borderBottom: "1px solid #e5e5e5",
      }}
    >
      <a
        href="/2"
        className="text-lg font-bold tracking-tight"
        style={{ color: "#0a0a0a" }}
      >
        otterdeploy
      </a>

      <div className="flex items-center gap-4">
        <div className="hidden items-center gap-1.5 sm:flex">
          {VARIANT_IDS.map((id) => (
            <Link
              key={id}
              to={`/${id}` as string}
              className="flex h-6 w-6 items-center justify-center rounded-md text-[10px] font-semibold transition-colors duration-150"
              style={{
                backgroundColor: id === 2 ? "#7c3aed" : "transparent",
                color: id === 2 ? "#ffffff" : "#999999",
                border:
                  id === 2 ? "1px solid #7c3aed" : "1px solid #e5e5e5",
              }}
            >
              {id}
            </Link>
          ))}
        </div>
        <a
          href="#get-started"
          className="rounded-lg px-5 py-2 text-sm font-semibold transition-opacity duration-150 hover:opacity-90"
          style={{ backgroundColor: "#0a0a0a", color: "#ffffff" }}
        >
          Get Started
        </a>
      </div>
    </nav>
  );
}

/* ==================== HERO ==================== */

function HeroSection() {
  return (
    <section
      className="relative flex flex-col items-center px-6 pt-32 pb-12 md:pt-40 md:pb-20"
      style={{ backgroundColor: "#ffffff" }}
    >
      <div className="mx-auto max-w-4xl text-center">
        <motion.div
          custom={0}
          initial="hidden"
          animate="visible"
          variants={fadeUp}
          className="mb-8 flex justify-center"
        >
          <div
            className="flex h-12 w-12 items-center justify-center rounded-xl"
            style={{ backgroundColor: "#f3f0ff", border: "1px solid #e5e5e5" }}
          >
            <Rocket size={22} style={{ color: "#7c3aed" }} />
          </div>
        </motion.div>

        <motion.h1
          custom={1}
          initial="hidden"
          animate="visible"
          variants={fadeUp}
          className="mb-6 text-5xl font-extrabold leading-tight tracking-tight md:text-6xl lg:text-7xl"
          style={{ color: "#0a0a0a" }}
        >
          The Unified Platform
          <br />
          for Self-Hosted{" "}
          <span style={{ color: "#7c3aed" }}>Deploys</span>
        </motion.h1>

        <motion.p
          custom={2}
          initial="hidden"
          animate="visible"
          variants={fadeUp}
          className="mx-auto mb-10 max-w-2xl text-lg leading-relaxed"
          style={{ color: "#666666" }}
        >
          Define, deploy, and manage your entire infrastructure stack from a
          single config file — built for scale, speed, and sanity.
        </motion.p>

        <motion.div
          custom={3}
          initial="hidden"
          animate="visible"
          variants={fadeUp}
          className="mb-20 flex flex-wrap items-center justify-center gap-4"
        >
          <a
            href="#get-started"
            className="inline-flex items-center gap-2 rounded-lg px-6 py-3 text-sm font-semibold transition-opacity duration-150 hover:opacity-90"
            style={{ backgroundColor: "#0a0a0a", color: "#ffffff" }}
          >
            Get started
            <ArrowRight size={16} />
          </a>
          <a
            href="#features"
            className="inline-flex items-center gap-2 rounded-lg px-6 py-3 text-sm font-semibold transition-colors duration-150"
            style={{ border: "1px solid #e5e5e5", color: "#666666" }}
          >
            Learn more
          </a>
        </motion.div>

        {/* Isometric architecture diagram */}
        <motion.div
          custom={4}
          initial="hidden"
          animate="visible"
          variants={fadeUp}
          className="mx-auto"
          style={{ maxWidth: 500, perspective: "1000px" }}
        >
          <div
            style={{
              transform: "rotateX(55deg) rotateZ(-45deg)",
              transformStyle: "preserve-3d",
            }}
          >
            <div className="relative mx-auto grid grid-cols-3 gap-2" style={{ width: 260 }}>
              {Array.from({ length: 9 }).map((_, i) => {
                const isAccent = i === 1 || i === 4 || i === 7;
                return (
                  <div
                    key={i}
                    className="flex items-center justify-center rounded-lg"
                    style={{
                      width: 80,
                      height: 80,
                      backgroundColor: isAccent ? "#f3f0ff" : "#f8f8f8",
                      border: isAccent ? "1.5px solid #7c3aed" : "1px solid #e5e5e5",
                      boxShadow: "0 4px 0 0 #e5e5e5",
                    }}
                  />
                );
              })}
            </div>

            {/* Connected node labels */}
            <div
              className="absolute rounded-md px-3 py-1 text-xs font-bold"
              style={{
                top: -36,
                left: "50%",
                transform: "translateX(-50%) rotateZ(45deg) rotateX(-55deg)",
                backgroundColor: "#7c3aed",
                color: "#ffffff",
              }}
            >
              .WEB
            </div>
            <div
              className="absolute rounded-md px-3 py-1 text-xs font-bold"
              style={{
                bottom: -36,
                left: "50%",
                transform: "translateX(-50%) rotateZ(45deg) rotateX(-55deg)",
                backgroundColor: "#0a0a0a",
                color: "#ffffff",
              }}
            >
              .DB
            </div>
            <div
              className="absolute rounded-md px-3 py-1 text-xs font-bold"
              style={{
                top: "50%",
                left: -50,
                transform: "translateY(-50%) rotateZ(45deg) rotateX(-55deg)",
                backgroundColor: "#0a0a0a",
                color: "#ffffff",
              }}
            >
              .API
            </div>
            <div
              className="absolute rounded-md px-3 py-1 text-xs font-bold"
              style={{
                top: "50%",
                right: -70,
                transform: "translateY(-50%) rotateZ(45deg) rotateX(-55deg)",
                backgroundColor: "#0a0a0a",
                color: "#ffffff",
              }}
            >
              .CACHE
            </div>
            <div
              className="absolute rounded-md px-3 py-1 text-xs font-bold"
              style={{
                top: -10,
                right: -60,
                transform: "rotateZ(45deg) rotateX(-55deg)",
                backgroundColor: "#0a0a0a",
                color: "#ffffff",
              }}
            >
              .WORKER
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}

/* ==================== EVERYTHING YOU NEED ==================== */

function EverythingSection() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });

  return (
    <section
      ref={ref}
      className="px-6 py-24 md:px-12 md:py-32"
      style={{ backgroundColor: "#f8f8f8", borderTop: "1px solid #e5e5e5" }}
    >
      <div className="mx-auto max-w-7xl">
        <motion.h2
          initial={{ opacity: 0, y: 24 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6, ease }}
          className="mb-4 text-4xl font-bold tracking-tight md:text-5xl"
          style={{ color: "#0a0a0a" }}
        >
          Everything you need to ship
        </motion.h2>
        <motion.p
          initial={{ opacity: 0, y: 24 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6, delay: 0.1, ease }}
          className="mb-6 text-xl"
          style={{ color: "#666666" }}
        >
          — plus everything you've been duct-taping together.
        </motion.p>
        <motion.p
          initial={{ opacity: 0, y: 24 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6, delay: 0.2, ease }}
          className="max-w-2xl text-base leading-relaxed"
          style={{ color: "#999999" }}
        >
          Built for growing teams tired of managing, patching, and replacing
          their deployment infrastructure. One platform. Every resource type.
          Zero duct tape.
        </motion.p>
      </div>
    </section>
  );
}

/* ==================== DARK AURORA + TERMINAL ==================== */

function DarkTerminalSection() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });

  const terminalLines = [
    { text: "$ otter deploy --env production", color: "#e5e5e5" },
    { text: "", color: "" },
    { text: "otterdeploy v2.4.0 ready in 12s", color: "#a78bfa" },
    { text: "", color: "" },
    { text: "\u2192 Building services...", color: "#e5e5e5" },
    { text: "  \u2713 web        Built in 8s", color: "#4ade80" },
    { text: "  \u2713 api        Built in 5s", color: "#4ade80" },
    { text: "  \u2713 worker     Built in 3s", color: "#4ade80" },
    { text: "", color: "" },
    { text: "\u2192 Deploying to production...", color: "#e5e5e5" },
    { text: "  \u2713 web        \u2192 https://myapp.com", color: "#22d3ee" },
    { text: "  \u2713 api        \u2192 https://api.myapp.com", color: "#22d3ee" },
    { text: "  \u2713 postgres   Connected", color: "#4ade80" },
    { text: "  \u2713 redis      Connected", color: "#4ade80" },
    { text: "", color: "" },
    { text: "Deploy complete! All services healthy.", color: "#4ade80" },
  ];

  return (
    <section
      ref={ref}
      className="relative px-6 py-24 md:px-12 md:py-32"
      style={{ background: auroraGradient }}
    >
      <div className="mx-auto max-w-3xl">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.7, ease }}
          className="overflow-hidden rounded-xl"
          style={{ border: "1px solid rgba(255,255,255,0.1)", backgroundColor: "rgba(0,0,0,0.6)" }}
        >
          {/* Window chrome */}
          <div
            className="flex items-center gap-2 px-4 py-3"
            style={{ borderBottom: "1px solid rgba(255,255,255,0.1)" }}
          >
            <span className="h-3 w-3 rounded-full" style={{ backgroundColor: "#ef4444" }} />
            <span className="h-3 w-3 rounded-full" style={{ backgroundColor: "#eab308" }} />
            <span className="h-3 w-3 rounded-full" style={{ backgroundColor: "#22c55e" }} />
            <span className="ml-3 text-xs" style={{ color: "#666666", fontFamily: mono }}>
              terminal
            </span>
          </div>
          <pre
            className="px-6 py-5 text-[13px] leading-relaxed"
            style={{ fontFamily: mono }}
          >
            {terminalLines.map((line, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0 }}
                animate={inView ? { opacity: 1 } : {}}
                transition={{ duration: 0.3, delay: 0.3 + i * 0.08, ease }}
              >
                {line.text ? (
                  <span style={{ color: line.color }}>{line.text}</span>
                ) : (
                  <br />
                )}
              </motion.div>
            ))}
          </pre>
        </motion.div>
      </div>
    </section>
  );
}

/* ==================== FEATURE CARDS GRID ==================== */

function FeatureCardsGrid() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });

  return (
    <section
      id="features"
      ref={ref}
      className="px-6 py-24 md:px-12 md:py-32"
      style={{ backgroundColor: "#ffffff", borderTop: "1px solid #e5e5e5" }}
    >
      <div className="mx-auto max-w-7xl">
        {/* Three columns with border separators */}
        <div
          className="grid grid-cols-1 md:grid-cols-3"
          style={{ border: "1px solid #e5e5e5" }}
        >
          {FEATURE_CARDS.map((card, i) => (
            <motion.div
              key={card.title}
              initial={{ opacity: 0, y: 20 }}
              animate={inView ? { opacity: 1, y: 0 } : {}}
              transition={{ duration: 0.5, delay: i * 0.1, ease }}
              className="p-8 md:p-10"
              style={{
                borderRight: i < 2 ? "1px solid #e5e5e5" : "none",
                borderBottom: "1px solid #e5e5e5",
              }}
            >
              <h3
                className="mb-3 text-lg font-bold"
                style={{ color: "#0a0a0a" }}
              >
                {card.title}
              </h3>
              <p
                className="mb-5 text-sm leading-relaxed"
                style={{ color: "#666666" }}
              >
                {card.desc}
              </p>
              <div className="flex flex-wrap gap-2">
                {card.badges.map((badge) => (
                  <span
                    key={badge}
                    className="rounded-md px-2.5 py-1 text-xs font-medium"
                    style={{
                      backgroundColor: "#f8f8f8",
                      border: "1px solid #e5e5e5",
                      color: "#666666",
                    }}
                  >
                    {badge}
                  </span>
                ))}
              </div>
            </motion.div>
          ))}
        </div>

        {/* Productivity at Scale */}
        <motion.h2
          initial={{ opacity: 0, y: 20 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6, delay: 0.4, ease }}
          className="mt-20 mb-8 text-4xl font-bold tracking-tight"
          style={{ color: "#0a0a0a" }}
        >
          Productivity at Scale
        </motion.h2>

        <div
          className="grid grid-cols-1 md:grid-cols-2"
          style={{ border: "1px solid #e5e5e5" }}
        >
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={inView ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: 0.5, delay: 0.5, ease }}
            className="p-8 md:p-10"
            style={{ borderRight: "1px solid #e5e5e5" }}
          >
            <h3
              className="mb-3 text-lg font-bold"
              style={{ color: "#0a0a0a" }}
            >
              A trusted stack to standardize on
            </h3>
            <p
              className="mb-6 text-sm leading-relaxed"
              style={{ color: "#666666" }}
            >
              Used by teams shipping to production daily. Otterdeploy provides a
              consistent deployment experience regardless of team size or stack
              complexity.
            </p>
            <div className="flex gap-8">
              <div>
                <p className="text-2xl font-bold" style={{ color: "#0a0a0a" }}>
                  2.4k+
                </p>
                <p className="text-xs" style={{ color: "#999999" }}>
                  GitHub stars
                </p>
              </div>
              <div>
                <p className="text-2xl font-bold" style={{ color: "#0a0a0a" }}>
                  18k+
                </p>
                <p className="text-xs" style={{ color: "#999999" }}>
                  Weekly downloads
                </p>
              </div>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={inView ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: 0.5, delay: 0.6, ease }}
            className="p-8 md:p-10"
          >
            <h3
              className="mb-3 text-lg font-bold"
              style={{ color: "#0a0a0a" }}
            >
              Stay fast at scale
            </h3>
            <p
              className="mb-6 text-sm leading-relaxed"
              style={{ color: "#666666" }}
            >
              Optimized for speed at every layer. From build caching to
              incremental deploys, your pipeline stays fast as your team and
              codebase grow.
            </p>
            <div className="flex gap-8">
              <div>
                <p className="text-2xl font-bold" style={{ color: "#7c3aed" }}>
                  40x
                </p>
                <p className="text-xs" style={{ color: "#999999" }}>
                  faster deploys
                </p>
              </div>
              <div>
                <p className="text-2xl font-bold" style={{ color: "#7c3aed" }}>
                  10x
                </p>
                <p className="text-xs" style={{ color: "#999999" }}>
                  fewer incidents
                </p>
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}

/* ==================== FEATURE TABS SECTION ==================== */

function FeatureTabsSection() {
  const [activeTab, setActiveTab] = useState("define");
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });

  const active = TABS.find((t) => t.id === activeTab)!;

  return (
    <section
      ref={ref}
      className="relative px-6 py-24 md:px-12 md:py-32"
      style={{ background: auroraGradient }}
    >
      <div className="mx-auto max-w-7xl">
        <motion.h2
          initial={{ opacity: 0, y: 24 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6, ease }}
          className="mb-12 text-center text-3xl font-bold tracking-tight text-white md:text-4xl"
        >
          Everything you need in one platform
        </motion.h2>

        {/* Tab bar */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6, delay: 0.1, ease }}
          className="mb-12 flex flex-wrap justify-center gap-1"
        >
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = tab.id === activeTab;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className="flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-colors duration-150"
                style={{
                  backgroundColor: isActive
                    ? "rgba(124,58,237,0.2)"
                    : "transparent",
                  color: isActive ? "#ffffff" : "#999999",
                  border: isActive
                    ? "1px solid rgba(124,58,237,0.4)"
                    : "1px solid transparent",
                }}
              >
                <Icon size={16} />
                {tab.label}
              </button>
            );
          })}
        </motion.div>

        {/* Tab content */}
        <motion.div
          key={activeTab}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease }}
          className="grid grid-cols-1 items-start gap-12 lg:grid-cols-2"
        >
          {/* Left: text content */}
          <div className="py-4">
            <p
              className="mb-3 text-xs font-semibold uppercase tracking-widest"
              style={{ color: "#a78bfa" }}
            >
              {active.category}
            </p>
            <h3 className="mb-5 text-2xl font-bold text-white md:text-3xl">
              {active.heading}
            </h3>
            <ul className="space-y-3">
              {active.bullets.map((bullet) => (
                <li
                  key={bullet}
                  className="flex items-start gap-3 text-sm leading-relaxed"
                  style={{ color: "rgba(255,255,255,0.7)" }}
                >
                  <Check
                    size={16}
                    className="mt-0.5 flex-shrink-0"
                    style={{ color: "#7c3aed" }}
                  />
                  {bullet}
                </li>
              ))}
            </ul>
          </div>

          {/* Right: terminal preview */}
          <div
            className="overflow-hidden rounded-xl"
            style={{
              border: "1px solid rgba(255,255,255,0.1)",
              backgroundColor: "rgba(0,0,0,0.5)",
            }}
          >
            <div
              className="flex items-center gap-2 px-4 py-3"
              style={{ borderBottom: "1px solid rgba(255,255,255,0.1)" }}
            >
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: "#ef4444" }} />
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: "#eab308" }} />
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: "#22c55e" }} />
              <span className="ml-2 text-xs" style={{ color: "#666666", fontFamily: mono }}>
                {active.id === "define" ? "otterdeploy.yml" : "terminal"}
              </span>
            </div>
            <pre
              className="px-5 py-4 text-[13px] leading-relaxed"
              style={{ fontFamily: mono, overflow: "auto", maxHeight: 400 }}
            >
              {active.terminal.map((line, i) => (
                <div key={i}>
                  {line.text ? (
                    <span style={{ color: line.color }}>{line.text}</span>
                  ) : (
                    <br />
                  )}
                </div>
              ))}
            </pre>
          </div>
        </motion.div>
      </div>
    </section>
  );
}

/* ==================== STATS ==================== */

function StatsSection() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-60px" });

  return (
    <section
      ref={ref}
      className="px-6 py-24 md:px-12"
      style={{ backgroundColor: "#ffffff", borderTop: "1px solid #e5e5e5" }}
    >
      <div
        className="mx-auto grid max-w-5xl grid-cols-2 md:grid-cols-4"
        style={{ border: "1px solid #e5e5e5" }}
      >
        {STATS.map((stat, i) => {
          const Icon = stat.icon;
          return (
            <motion.div
              key={stat.label}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={inView ? { opacity: 1, scale: 1 } : {}}
              transition={{ duration: 0.5, delay: i * 0.1, ease }}
              className="flex flex-col items-center p-8 text-center"
              style={{
                borderRight: i < 3 ? "1px solid #e5e5e5" : "none",
              }}
            >
              <div
                className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg"
                style={{ backgroundColor: "#f3f0ff" }}
              >
                <Icon size={18} style={{ color: "#7c3aed" }} />
              </div>
              <span
                className="text-3xl font-extrabold md:text-4xl"
                style={{ color: "#0a0a0a" }}
              >
                {stat.value}
              </span>
              <span
                className="mt-2 text-sm"
                style={{ color: "#999999" }}
              >
                {stat.label}
              </span>
            </motion.div>
          );
        })}
      </div>
    </section>
  );
}

/* ==================== TWO COLUMN FEATURES ==================== */

function TwoColumnFeatures() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });

  return (
    <section
      ref={ref}
      className="px-6 py-24 md:px-12 md:py-32"
      style={{ backgroundColor: "#f8f8f8", borderTop: "1px solid #e5e5e5" }}
    >
      <div className="mx-auto max-w-7xl">
        <div
          className="grid grid-cols-1 md:grid-cols-2"
          style={{ border: "1px solid #e5e5e5" }}
        >
          {/* Left column */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={inView ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: 0.6, ease }}
            className="p-8 md:p-12"
            style={{
              borderRight: "1px solid #e5e5e5",
              backgroundColor: "#ffffff",
            }}
          >
            <h3
              className="mb-6 text-2xl font-bold"
              style={{ color: "#0a0a0a" }}
            >
              Focus on shipping, not tooling
            </h3>
            <ul className="space-y-4">
              {SHIPPING_BULLETS.map((item) => (
                <li
                  key={item}
                  className="flex items-start gap-3 text-sm leading-relaxed"
                  style={{ color: "#666666" }}
                >
                  <span
                    className="mt-2 h-1.5 w-1.5 flex-shrink-0 rounded-full"
                    style={{ backgroundColor: "#7c3aed" }}
                  />
                  {item}
                </li>
              ))}
            </ul>
          </motion.div>

          {/* Right column */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={inView ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: 0.6, delay: 0.15, ease }}
            className="p-8 md:p-12"
            style={{ backgroundColor: "#ffffff" }}
          >
            <h3
              className="mb-4 text-2xl font-bold"
              style={{ color: "#0a0a0a" }}
            >
              Supply chain security
            </h3>
            <p
              className="mb-8 text-sm leading-relaxed"
              style={{ color: "#666666" }}
            >
              Every layer of the platform is designed with security as a first
              principle. From encrypted secrets to audited dependencies, your
              infrastructure is protected by default.
            </p>
            <div className="space-y-3">
              {SECURITY_CHECKS.map((check) => (
                <div
                  key={check}
                  className="flex items-center gap-3"
                >
                  <div
                    className="flex h-6 w-6 items-center justify-center rounded-md"
                    style={{ backgroundColor: "#f3f0ff" }}
                  >
                    <Check size={14} style={{ color: "#7c3aed" }} />
                  </div>
                  <span
                    className="text-sm font-medium"
                    style={{ color: "#0a0a0a" }}
                  >
                    {check}
                  </span>
                </div>
              ))}
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}

/* ==================== PRICING ==================== */

function PricingSection() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });

  return (
    <section
      ref={ref}
      className="px-6 py-24 md:px-12 md:py-32"
      style={{ backgroundColor: "#ffffff", borderTop: "1px solid #e5e5e5" }}
    >
      <div className="mx-auto max-w-7xl">
        <div style={{ border: "1px solid #e5e5e5" }}>
          <div className="grid grid-cols-1 md:grid-cols-3">
            {/* Left cell spanning visually */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={inView ? { opacity: 1, y: 0 } : {}}
              transition={{ duration: 0.6, ease }}
              className="flex flex-col justify-center p-8 md:row-span-1 md:p-12"
              style={{
                borderRight: "1px solid #e5e5e5",
                borderBottom: "1px solid #e5e5e5",
              }}
            >
              <h2
                className="mb-3 text-3xl font-bold tracking-tight md:text-4xl"
                style={{ color: "#0a0a0a" }}
              >
                License &amp; Pricing
              </h2>
              <p className="text-sm leading-relaxed" style={{ color: "#666666" }}>
                Otterdeploy is open source and free forever. Upgrade for
                team features, priority support, and enterprise compliance.
              </p>
            </motion.div>

            {/* Pricing tiers */}
            {PRICING.map((plan, i) => (
              <motion.div
                key={plan.tier}
                initial={{ opacity: 0, y: 20 }}
                animate={inView ? { opacity: 1, y: 0 } : {}}
                transition={{ duration: 0.5, delay: 0.1 + i * 0.1, ease }}
                className="p-8 md:p-10"
                style={{
                  borderRight: i < 2 ? "1px solid #e5e5e5" : "none",
                  borderBottom: "1px solid #e5e5e5",
                }}
              >
                <p
                  className="mb-3 text-xs font-semibold uppercase tracking-widest"
                  style={{ color: "#999999" }}
                >
                  {plan.tier}
                </p>
                <p
                  className="mb-4 text-3xl font-extrabold"
                  style={{ color: "#0a0a0a" }}
                >
                  {plan.name}
                </p>
                <p
                  className="text-sm leading-relaxed"
                  style={{ color: "#666666" }}
                >
                  {plan.desc}
                </p>
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/* ==================== CTA ==================== */

function CTASection() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });

  return (
    <section
      id="get-started"
      ref={ref}
      className="relative px-6 py-28 md:px-12 md:py-40"
      style={{ background: auroraGradient }}
    >
      <div className="relative mx-auto max-w-3xl text-center">
        <motion.h2
          initial={{ opacity: 0, y: 24 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.7, ease }}
          className="mb-6 text-4xl font-extrabold leading-tight text-white md:text-5xl lg:text-6xl"
        >
          Take your infrastructure
          <br />
          to the next level
        </motion.h2>

        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6, delay: 0.1, ease }}
          className="mb-10 text-base leading-relaxed md:text-lg"
          style={{ color: "rgba(255,255,255,0.6)" }}
        >
          Free, open source, and built for teams who ship fast.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6, delay: 0.2, ease }}
          className="flex flex-wrap items-center justify-center gap-4"
        >
          <a
            href="#"
            className="inline-flex items-center gap-2 rounded-lg px-7 py-3.5 text-sm font-semibold transition-opacity duration-150 hover:opacity-90"
            style={{ backgroundColor: "#ffffff", color: "#0a0a0a" }}
          >
            Get started
            <ArrowRight size={16} />
          </a>
          <a
            href="#"
            className="inline-flex items-center gap-2 rounded-lg px-7 py-3.5 text-sm font-semibold transition-colors duration-150"
            style={{
              border: "1px solid rgba(255,255,255,0.3)",
              color: "#ffffff",
            }}
          >
            Learn more
          </a>
        </motion.div>
      </div>
    </section>
  );
}

/* ==================== FOOTER ==================== */

function Footer() {
  return (
    <footer
      className="px-6 pt-16 pb-12 md:px-12"
      style={{
        backgroundColor: "#0a0a0a",
        borderTop: "1px solid rgba(255,255,255,0.1)",
      }}
    >
      <div className="mx-auto max-w-7xl">
        <div className="mb-16 grid grid-cols-2 gap-8 md:grid-cols-4">
          {/* Brand */}
          <div className="col-span-2 md:col-span-1">
            <p className="mb-3 text-base font-bold text-white">otterdeploy</p>
            <p
              className="text-sm leading-relaxed"
              style={{ color: "#666666" }}
            >
              Open-source, self-hosted PaaS for teams who ship fast.
            </p>
          </div>

          {FOOTER_COLS.map((col) => (
            <div key={col.title}>
              <p
                className="mb-4 text-xs font-semibold uppercase tracking-wider"
                style={{ color: "#666666" }}
              >
                {col.title}
              </p>
              <ul className="space-y-2.5">
                {col.links.map((link) => (
                  <li key={link}>
                    <a
                      href="#"
                      className="text-sm transition-colors duration-150 hover:text-white"
                      style={{ color: "#999999" }}
                    >
                      {link}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div
          className="flex flex-col items-center justify-between gap-4 pt-8 md:flex-row"
          style={{ borderTop: "1px solid rgba(255,255,255,0.1)" }}
        >
          <p className="text-xs" style={{ color: "#666666" }}>
            &copy; 2026 Otterdeploy. All rights reserved.
          </p>
          <div className="flex items-center gap-5">
            <a
              href="#"
              className="transition-colors duration-150 hover:text-white"
              style={{ color: "#666666" }}
              aria-label="GitHub"
            >
              <Github size={16} />
            </a>
            <a
              href="#"
              className="transition-colors duration-150 hover:text-white"
              style={{ color: "#666666" }}
              aria-label="Twitter"
            >
              <Twitter size={16} />
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
