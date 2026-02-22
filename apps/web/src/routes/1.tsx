import { createFileRoute } from "@tanstack/react-router";
import { motion, useInView } from "motion/react";
import {
  GitBranch,
  Shield,
  Terminal,
  Activity,
  Lock,
  Users,
  Github,
  ExternalLink,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

export const Route = createFileRoute("/1")({
  component: RouteComponent,
});

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GREEN = "#00ff41";
const RED = "#ff3e3e";
const BG = "#050505";
const TEXT = "#e0e0e0";
const BORDER = "#1a1a1a";
const MUTED = "#666666";

const NAV_LINKS = [
  { label: "v1", to: "/1" },
  { label: "v2", to: "/2" },
  { label: "v3", to: "/3" },
  { label: "v4", to: "/4" },
  { label: "v5", to: "/5" },
];

const FEATURES = [
  {
    title: "Declarative Config",
    icon: Terminal,
    desc: "Define your entire infrastructure in a single YAML file. Version-controlled, repeatable, auditable.",
    snippet: `# otter.yaml\nservices:\n  api:\n    image: node:20\n    port: 3000\n    replicas: 3`,
  },
  {
    title: "Git-Driven Deploys",
    icon: GitBranch,
    desc: "Push to main and your app is live. Branch previews, rollbacks, and deploy hooks out of the box.",
    snippet: `$ git push origin main\n> Deploying api@v1.4.2...\n> Build complete (14s)\n> Live at api.your.app`,
  },
  {
    title: "Multi-Environment",
    icon: Activity,
    desc: "Staging, production, preview — spin up isolated environments with a single command.",
    snippet: `$ otter env create staging\n> Cloned from production\n> Secrets inherited\n> Ready in 8s`,
  },
  {
    title: "Real-time Dashboard",
    icon: Activity,
    desc: "Logs, metrics, and deploy status streaming live. No refresh needed. Built on WebSockets.",
    snippet: `[stream] cpu: 23%  mem: 512MB\n[stream] req/s: 1.4K\n[stream] p99: 42ms\n[stream] status: healthy`,
  },
  {
    title: "Secrets Management",
    icon: Lock,
    desc: "Encrypted at rest, scoped per environment. Rotate without redeploying. Audit every access.",
    snippet: `$ otter secret set DB_URL\n> Enter value: ********\n> Encrypted (AES-256)\n> Scoped to: production`,
  },
  {
    title: "RBAC & Multi-tenancy",
    icon: Users,
    desc: "Teams, roles, and granular permissions. Isolate projects with org-level boundaries.",
    snippet: `roles:\n  deployer:\n    - deploy:create\n    - logs:read\n  admin:\n    - "*"`,
  },
];

const WORKFLOW_STEPS = [
  {
    cmd: "$ otter init",
    desc: "Define your stack in a single config file",
  },
  {
    cmd: "$ git push origin main",
    desc: "Push to deploy automatically",
  },
  {
    cmd: "$ otter status",
    desc: "Monitor everything in real-time",
  },
];

const STATS = [
  "1.2K+ DEPLOYS",
  "99.9% UPTIME",
  "<30s BUILDS",
  "OSS FOREVER",
];

const DEPLOY_CONFIG_LINES = [
  "# otter.yaml",
  "project: otterdeploy-demo",
  "",
  "services:",
  "  web:",
  "    build: ./apps/web",
  "    port: 3000",
  "    env: production",
  "    replicas: 2",
  "",
  "  api:",
  "    build: ./apps/server",
  "    port: 8080",
  "    health: /healthz",
  "",
  "deploy:",
  "  strategy: rolling",
  "  auto_rollback: true",
];

// ---------------------------------------------------------------------------
// Small reusable pieces
// ---------------------------------------------------------------------------

function BlinkingCursor() {
  return (
    <span
      className="inline-block w-[10px] h-[20px] ml-1 align-middle"
      style={{
        backgroundColor: GREEN,
        animation: "blink 1s step-end infinite",
      }}
    />
  );
}

function TerminalDots() {
  return (
    <span className="flex gap-1.5 items-center">
      <span
        className="w-2.5 h-2.5 rounded-full"
        style={{ backgroundColor: RED }}
      />
      <span
        className="w-2.5 h-2.5 rounded-full"
        style={{ backgroundColor: "#ffbd2e" }}
      />
      <span
        className="w-2.5 h-2.5 rounded-full"
        style={{ backgroundColor: GREEN }}
      />
    </span>
  );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <h2
      className="text-2xl md:text-3xl font-bold mb-12 tracking-tight"
      style={{ color: GREEN, fontFamily: "'IBM Plex Mono', monospace" }}
    >
      {children}
    </h2>
  );
}

function AsciiDivider() {
  return (
    <div
      className="w-full text-center select-none overflow-hidden"
      style={{ color: BORDER }}
      aria-hidden
    >
      {"═".repeat(80)}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

function NavBar() {
  return (
    <nav
      className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-4 md:px-8 py-3"
      style={{
        backgroundColor: `${BG}ee`,
        borderBottom: `1px solid ${BORDER}`,
        backdropFilter: "blur(8px)",
        fontFamily: "'IBM Plex Mono', monospace",
      }}
    >
      <a
        href="/"
        className="text-lg font-bold tracking-tighter"
        style={{ color: GREEN }}
      >
        otterdeploy
      </a>

      <div className="hidden md:flex items-center gap-4">
        {NAV_LINKS.map((l) => (
          <a
            key={l.to}
            href={l.to}
            className="text-xs px-2 py-1 transition-colors hover:opacity-80"
            style={{
              color: l.to === "/1" ? GREEN : MUTED,
              borderBottom:
                l.to === "/1" ? `1px solid ${GREEN}` : "1px solid transparent",
            }}
          >
            {l.label}
          </a>
        ))}
      </div>

      <a
        href="#get-started"
        className="text-sm px-4 py-1.5 font-medium transition-all hover:brightness-110"
        style={{
          color: BG,
          backgroundColor: GREEN,
          fontFamily: "'IBM Plex Mono', monospace",
        }}
      >
        $ deploy
      </a>
    </nav>
  );
}

function HeroSection() {
  const lines = ["DEPLOY.", "ANYTHING.", "ANYWHERE."];

  return (
    <section
      className="relative min-h-screen flex flex-col items-center justify-center px-4 pt-20 pb-16"
      style={{ fontFamily: "'IBM Plex Mono', monospace" }}
    >
      {/* ASCII corner decoration */}
      <div
        className="absolute top-20 left-4 md:left-12 text-xs select-none hidden md:block"
        style={{ color: BORDER }}
        aria-hidden
      >
        {"╔══════════════╗\n║  OTTERDEPLOY  ║\n╚══════════════╝"}
      </div>

      <div className="max-w-4xl w-full text-center">
        {/* Main heading */}
        <div className="mb-6">
          {lines.map((line, i) => (
            <motion.div
              key={line}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 + i * 0.18, duration: 0.5 }}
            >
              <span
                className="block text-5xl md:text-7xl lg:text-8xl font-bold leading-[1.05] tracking-tighter"
                style={{ color: TEXT }}
              >
                {line}
                {i === lines.length - 1 && <BlinkingCursor />}
              </span>
            </motion.div>
          ))}
        </div>

        {/* Subtitle */}
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.9, duration: 0.6 }}
          className="text-sm md:text-base mb-10"
          style={{ color: MUTED }}
        >
          {"// self-hosted PaaS for teams who ship fast"}
        </motion.p>

        {/* Terminal mockup */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 1.1, duration: 0.6 }}
          className="max-w-xl mx-auto mb-10 text-left rounded-md overflow-hidden"
          style={{
            border: `1px solid ${BORDER}`,
            backgroundColor: "#0a0a0a",
          }}
        >
          <div
            className="flex items-center gap-2 px-3 py-2"
            style={{ borderBottom: `1px solid ${BORDER}` }}
          >
            <TerminalDots />
            <span className="text-xs ml-2" style={{ color: MUTED }}>
              otter.yaml
            </span>
          </div>
          <div className="p-4 text-xs md:text-sm leading-relaxed overflow-x-auto">
            {DEPLOY_CONFIG_LINES.map((line, i) => (
              <motion.div
                key={`${i}-${line}`}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 1.3 + i * 0.06, duration: 0.3 }}
                style={{
                  color: line.startsWith("#")
                    ? MUTED
                    : line.includes(":")
                      ? TEXT
                      : TEXT,
                }}
              >
                {line.startsWith("#") ? (
                  <span style={{ color: MUTED }}>{line}</span>
                ) : line.includes(":") ? (
                  <>
                    <span style={{ color: GREEN }}>
                      {line.split(":")[0]}:
                    </span>
                    <span style={{ color: TEXT }}>
                      {line.substring(line.indexOf(":") + 1)}
                    </span>
                  </>
                ) : (
                  <span>{line || "\u00A0"}</span>
                )}
              </motion.div>
            ))}
          </div>
        </motion.div>

        {/* CTAs */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 2.2, duration: 0.5 }}
          className="flex flex-wrap justify-center gap-4"
        >
          <a
            href="#get-started"
            className="px-6 py-3 text-sm font-medium transition-all hover:brightness-110"
            style={{
              color: BG,
              backgroundColor: GREEN,
            }}
          >
            $ git clone
          </a>
          <a
            href="#features"
            className="px-6 py-3 text-sm font-medium transition-colors hover:opacity-80"
            style={{
              color: TEXT,
              border: `1px solid ${BORDER}`,
            }}
          >
            man otterdeploy
          </a>
        </motion.div>
      </div>
    </section>
  );
}

function FeatureCard({
  feature,
  index,
}: {
  feature: (typeof FEATURES)[number];
  index: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { once: true, margin: "-60px" });
  const Icon = feature.icon;

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 24 }}
      animate={isInView ? { opacity: 1, y: 0 } : {}}
      transition={{ delay: index * 0.1, duration: 0.5 }}
      className="rounded-md overflow-hidden flex flex-col"
      style={{
        border: `1px solid ${BORDER}`,
        backgroundColor: "#0a0a0a",
        fontFamily: "'IBM Plex Mono', monospace",
      }}
    >
      {/* Title bar */}
      <div
        className="flex items-center gap-2 px-3 py-2"
        style={{ borderBottom: `1px solid ${BORDER}` }}
      >
        <TerminalDots />
        <Icon size={13} style={{ color: GREEN }} className="ml-2" />
        <span className="text-xs font-medium" style={{ color: TEXT }}>
          {feature.title}
        </span>
      </div>

      {/* Description */}
      <div className="p-4 flex-1">
        <p className="text-xs leading-relaxed mb-4" style={{ color: MUTED }}>
          {feature.desc}
        </p>

        {/* Code snippet */}
        <div
          className="rounded p-3 text-[11px] leading-relaxed whitespace-pre overflow-x-auto"
          style={{
            backgroundColor: BG,
            border: `1px solid ${BORDER}`,
            color: GREEN,
          }}
        >
          {feature.snippet}
        </div>
      </div>
    </motion.div>
  );
}

function FeaturesSection() {
  return (
    <section id="features" className="px-4 md:px-8 py-24 max-w-6xl mx-auto">
      <SectionHeader>{"> CAPABILITIES"}</SectionHeader>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {FEATURES.map((f, i) => (
          <FeatureCard key={f.title} feature={f} index={i} />
        ))}
      </div>
    </section>
  );
}

function WorkflowSection() {
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { once: true, margin: "-80px" });

  return (
    <section ref={ref} className="px-4 md:px-8 py-24 max-w-3xl mx-auto">
      <SectionHeader>{"> WORKFLOW"}</SectionHeader>

      <div className="flex flex-col items-start">
        {WORKFLOW_STEPS.map((step, i) => (
          <motion.div
            key={step.cmd}
            initial={{ opacity: 0, x: -20 }}
            animate={isInView ? { opacity: 1, x: 0 } : {}}
            transition={{ delay: 0.2 + i * 0.25, duration: 0.5 }}
            className="w-full"
          >
            {/* Step */}
            <div
              className="flex items-start gap-4 py-4"
              style={{ fontFamily: "'IBM Plex Mono', monospace" }}
            >
              <span
                className="text-xs font-bold mt-1 shrink-0 w-6 h-6 flex items-center justify-center rounded-sm"
                style={{
                  color: BG,
                  backgroundColor: GREEN,
                }}
              >
                {i + 1}
              </span>
              <div>
                <p className="text-base md:text-lg font-bold" style={{ color: GREEN }}>
                  {step.cmd}
                </p>
                <p className="text-xs mt-1" style={{ color: MUTED }}>
                  {step.desc}
                </p>
              </div>
            </div>

            {/* Connector pipe */}
            {i < WORKFLOW_STEPS.length - 1 && (
              <div
                className="ml-3 pl-[9px] h-8 flex items-center"
                style={{ color: BORDER }}
              >
                <span className="text-sm select-none">{"│"}</span>
              </div>
            )}
          </motion.div>
        ))}
      </div>
    </section>
  );
}

function StatsSection() {
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { once: true, margin: "-40px" });

  return (
    <section ref={ref} className="px-4 md:px-8 py-16">
      <div
        className="max-w-5xl mx-auto flex flex-wrap justify-center gap-3 md:gap-6"
        style={{ fontFamily: "'IBM Plex Mono', monospace" }}
      >
        {STATS.map((stat, i) => (
          <motion.div
            key={stat}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={isInView ? { opacity: 1, scale: 1 } : {}}
            transition={{ delay: i * 0.12, duration: 0.4 }}
            className="px-4 md:px-6 py-3 text-xs md:text-sm font-bold tracking-wide"
            style={{
              color: GREEN,
              border: `1px solid ${BORDER}`,
              backgroundColor: "#0a0a0a",
            }}
          >
            [{stat}]
          </motion.div>
        ))}
      </div>
    </section>
  );
}

function CTASection() {
  const [copied, setCopied] = useState(false);
  const installCmd = "curl -fsSL https://get.otterdeploy.sh | sh";

  function handleCopy() {
    navigator.clipboard.writeText(installCmd).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <section
      id="get-started"
      className="px-4 md:px-8 py-24"
      style={{ fontFamily: "'IBM Plex Mono', monospace" }}
    >
      <div className="max-w-2xl mx-auto text-center">
        <motion.h2
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="text-3xl md:text-4xl font-bold mb-4 tracking-tight"
          style={{ color: TEXT }}
        >
          $ READY TO DEPLOY?
          <BlinkingCursor />
        </motion.h2>

        <motion.p
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ delay: 0.2, duration: 0.5 }}
          className="text-sm mb-10"
          style={{ color: MUTED }}
        >
          Get started in 60 seconds
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ delay: 0.3, duration: 0.5 }}
          className="rounded-md p-4 md:p-6 mb-8 text-left"
          style={{
            border: `1px solid ${GREEN}33`,
            backgroundColor: "#0a0a0a",
          }}
        >
          <div className="flex items-center justify-between gap-4">
            <code
              className="text-xs md:text-sm flex-1 overflow-x-auto"
              style={{ color: GREEN }}
            >
              <span style={{ color: MUTED }}>$ </span>
              {installCmd}
            </code>
            <button
              onClick={handleCopy}
              className="text-xs px-3 py-1 shrink-0 transition-colors cursor-pointer"
              style={{
                color: copied ? BG : GREEN,
                backgroundColor: copied ? GREEN : "transparent",
                border: `1px solid ${GREEN}55`,
              }}
              type="button"
            >
              {copied ? "copied!" : "copy"}
            </button>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ delay: 0.45, duration: 0.5 }}
          className="flex flex-wrap justify-center gap-4"
        >
          <a
            href="https://github.com/otterdeploy/otterdeploy"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium transition-all hover:brightness-110"
            style={{
              color: BG,
              backgroundColor: GREEN,
            }}
          >
            <Github size={15} />
            Star on GitHub
          </a>
          <a
            href="https://docs.otterdeploy.sh"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-5 py-2.5 text-sm transition-colors hover:opacity-80"
            style={{
              color: TEXT,
              border: `1px solid ${BORDER}`,
            }}
          >
            <ExternalLink size={15} />
            Documentation
          </a>
        </motion.div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer
      className="px-4 md:px-8 pt-8 pb-12"
      style={{ fontFamily: "'IBM Plex Mono', monospace" }}
    >
      <AsciiDivider />
      <div className="max-w-5xl mx-auto mt-8 flex flex-col md:flex-row items-center justify-between gap-4">
        <p className="text-xs" style={{ color: MUTED }}>
          <span style={{ color: GREEN }}>otterdeploy</span> — open source
          platform-as-a-service
        </p>
        <p className="text-xs" style={{ color: MUTED }}>
          {"// built with care, shipped with confidence"}
        </p>
      </div>
      <div
        className="max-w-5xl mx-auto mt-4 text-center text-xs select-none"
        style={{ color: BORDER }}
        aria-hidden
      >
        ░▓█ EOF █▓░
      </div>
    </footer>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

function RouteComponent() {
  // Load IBM Plex Mono
  useEffect(() => {
    const id = "ibm-plex-mono-font";
    if (document.getElementById(id)) return;
    const link = document.createElement("link");
    link.id = id;
    link.rel = "stylesheet";
    link.href =
      "https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;700&display=swap";
    document.head.appendChild(link);
  }, []);

  return (
    <div
      className="relative min-h-screen"
      style={{
        backgroundColor: BG,
        color: TEXT,
        fontFamily: "'IBM Plex Mono', monospace",
      }}
    >
      {/* Scanline overlay */}
      <div
        className="pointer-events-none fixed inset-0 z-40"
        style={{
          background:
            "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.08) 2px, rgba(0,0,0,0.08) 4px)",
        }}
        aria-hidden
      />

      {/* Dot grid background */}
      <div
        className="pointer-events-none fixed inset-0 z-0 opacity-[0.04]"
        style={{
          backgroundImage:
            "radial-gradient(circle, #ffffff 1px, transparent 1px)",
          backgroundSize: "24px 24px",
        }}
        aria-hidden
      />

      {/* Blinking cursor keyframes */}
      <style>{`
        @keyframes blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0; }
        }
      `}</style>

      <div className="relative z-10">
        <NavBar />
        <HeroSection />
        <AsciiDivider />
        <FeaturesSection />
        <AsciiDivider />
        <WorkflowSection />
        <AsciiDivider />
        <StatsSection />
        <AsciiDivider />
        <CTASection />
        <Footer />
      </div>
    </div>
  );
}
