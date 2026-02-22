import { createFileRoute, Link } from "@tanstack/react-router";
import { motion, useInView } from "motion/react";
import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Check,
  Copy,
  Github,
  Terminal,
  Shield,
  Server,
  Lock,
  DollarSign,
  Code2,
  X,
  Heart,
  Cloud,
  Activity,
  Database,
  HardDrive,
  Globe,
  Quote,
} from "lucide-react";

export const Route = createFileRoute("/15")({
  component: RouteComponent,
});

// ---------------------------------------------------------------------------
// Font Loader
// ---------------------------------------------------------------------------

function useFonts() {
  useEffect(() => {
    const id = "self-host-page-fonts";
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

const SELF_HOST_LABELS = [
  { label: ".YOUR_SERVER", x: -120, y: -50 },
  { label: ".YOUR_DATA", x: 220, y: -40 },
  { label: ".YOUR_RULES", x: 240, y: 80 },
  { label: ".DOCKER", x: -130, y: 90 },
  { label: ".BARE_METAL", x: 60, y: 200 },
];

const GRID_CELLS = [
  { label: "app", r: 0, c: 0 },
  { label: "api", r: 0, c: 1 },
  { label: "worker", r: 0, c: 2 },
  { label: "db", r: 1, c: 0 },
  { label: "cache", r: 1, c: 1 },
  { label: "cron", r: 1, c: 2 },
  { label: "ssl", r: 2, c: 0 },
  { label: "proxy", r: 2, c: 1 },
  { label: "logs", r: 2, c: 2 },
];

const STATS = [
  { value: "$0", label: "vendor fees" },
  { value: "100%", label: "data ownership" },
  { value: "\u221E", label: "customization" },
  { value: "MIT", label: "license" },
];

const FEATURE_TABS = {
  install: {
    label: "INSTALL",
    heading: "One command to start",
    bullets: [
      "Single curl command installs everything",
      "Docker Compose orchestration included",
      "Works on any Linux server",
      "No external dependencies required",
    ],
    code: `$ curl -fsSL https://get.otterdeploy.sh | sh

\u2192 Detecting system...
  \u2713 OS: Ubuntu 22.04 LTS
  \u2713 Docker: v24.0.7
  \u2713 Compose: v2.23.3

\u2192 Installing Otterdeploy v2.4.0...
  \u2713 Pulled otterdeploy/core:latest
  \u2713 Pulled otterdeploy/proxy:latest
  \u2713 Pulled postgres:16-alpine

\u2713 Otterdeploy is running!
  Dashboard: http://your-server:3000`,
  },
  configure: {
    label: "CONFIGURE",
    heading: "Set up your server",
    bullets: [
      "Point your domain to the server",
      "Automatic SSL via Let's Encrypt",
      "Configure resource limits",
      "Set up SSH keys and access",
    ],
    code: `# otterdeploy.yml
server:
  domain: deploy.mycompany.com
  ssl: auto  # Let's Encrypt

resources:
  memory: 8GB
  cpu: 4 cores
  storage: 100GB

access:
  ssh_keys:
    - ~/.ssh/id_ed25519.pub
  allowed_ips:
    - 10.0.0.0/8`,
  },
  deploy: {
    label: "DEPLOY",
    heading: "Ship your applications",
    bullets: [
      "Git push to deploy workflow",
      "Zero-downtime rolling updates",
      "Automatic health checks",
      "One-click rollback to any version",
    ],
    code: `$ otter deploy --env production

\u25B8 Building services...
  \u2713 web        Built in 12s
  \u2713 api        Built in 8s

\u25B8 Running health checks...
  \u2713 web        HTTP 200 (23ms)
  \u2713 api        HTTP 200 (18ms)

\u25B8 Switching traffic...
  \u2713 web        \u2192 app.mycompany.com
  \u2713 api        \u2192 api.mycompany.com

\u2713 Deploy complete! Zero downtime.`,
  },
  monitor: {
    label: "MONITOR",
    heading: "Built-in observability",
    bullets: [
      "Real-time resource metrics",
      "Application logs and tracing",
      "Uptime monitoring and alerts",
      "Disk, memory, and CPU dashboards",
    ],
    code: `$ otter status --all

\u25B8 Services (4 running)
  web      \u2713 healthy  CPU: 12%  MEM: 256MB
  api      \u2713 healthy  CPU: 8%   MEM: 128MB
  postgres \u2713 healthy  CPU: 5%   MEM: 512MB
  redis    \u2713 healthy  CPU: 2%   MEM: 64MB

\u25B8 Server
  Uptime:  47d 12h 33m
  CPU:     27% (4 cores)
  Memory:  960MB / 8GB
  Disk:    34GB / 100GB

\u2713 All systems operational`,
  },
};

type TabKey = keyof typeof FEATURE_TABS;

const TESTIMONIALS = [
  {
    name: "Marcus Chen",
    role: "CTO at Finova",
    text: "We cut our infrastructure bill by 73% after moving to self-hosted Otterdeploy. No more per-seat pricing surprises.",
    initials: "MC",
  },
  {
    name: "Sarah Kim",
    role: "Lead DevOps at MedSecure",
    text: "HIPAA compliance was a nightmare with cloud PaaS providers. With Otterdeploy, our data never leaves our servers. Auditors love it.",
    initials: "SK",
  },
  {
    name: "Daniel Okafor",
    role: "Founder at Stackwise",
    text: "Full control over the platform means we can customize everything. We even wrote custom deploy hooks for our workflow.",
    initials: "DO",
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
// Dot Grid Background
// ---------------------------------------------------------------------------

function DotGridBackground() {
  return (
    <div className="fixed inset-0 pointer-events-none z-0">
      <div
        className="absolute inset-0 opacity-[0.25]"
        style={{
          backgroundImage:
            "radial-gradient(circle, rgba(255,255,255,0.3) 1px, transparent 1px)",
          backgroundSize: "24px 24px",
        }}
      />
      <div
        className="absolute inset-0"
        style={{
          background: `radial-gradient(ellipse at 30% 20%, rgba(124,58,237,0.15) 0%, transparent 50%),
                       radial-gradient(ellipse at 70% 60%, rgba(167,139,250,0.08) 0%, transparent 50%),
                       radial-gradient(ellipse at 50% 90%, rgba(34,211,238,0.05) 0%, transparent 40%)`,
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
          {["Documentation", "Self-Host", "Pricing"].map((item) => (
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
                  v.to === "/15"
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
            <Server size={14} /> Self-Host Now
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
    <div ref={ref} className="flex justify-center mt-16">
      <div className="relative" style={{ width: 500, height: 380 }}>
        <div
          className="absolute left-1/2 top-1/2"
          style={{
            transform: "translate(-50%, -50%) rotateX(55deg) rotateZ(-45deg)",
            transformStyle: "preserve-3d",
          }}
        >
          <div className="grid grid-cols-3 gap-2" style={{ width: 240, height: 240 }}>
            {GRID_CELLS.map((cell, i) => (
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

        {SELF_HOST_LABELS.map((node, i) => (
          <motion.div
            key={node.label}
            className="absolute px-3 py-1.5 rounded-md border border-white/[0.08] bg-[#18181b]"
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

        <svg className="absolute inset-0 w-full h-full pointer-events-none" style={{ zIndex: -1 }}>
          {SELF_HOST_LABELS.map((node, i) => (
            <motion.line
              key={i}
              x1="50%"
              y1="50%"
              x2={`calc(50% + ${node.x + 30}px)`}
              y2={`calc(50% + ${node.y + 10}px)`}
              stroke="rgba(124,58,237,0.2)"
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
  const installCmd = "curl -fsSL https://get.otterdeploy.sh | sh";

  const handleCopy = () => {
    navigator.clipboard.writeText(installCmd);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <section ref={ref} className="relative pt-28 pb-16 px-5">
      <div className="max-w-5xl mx-auto text-center relative z-10">
        <motion.div
          className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-white/[0.08] bg-[#18181b] mb-8"
          initial={{ opacity: 0, y: 10 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ ...ease, delay: 0.05 }}
        >
          <Server size={14} className="text-[#a78bfa]" />
          <span className="text-sm text-[#a1a1aa] font-medium" style={font.body}>
            Your Servers &middot; Your Data &middot; Your Rules
          </span>
        </motion.div>

        <motion.h1
          className="text-5xl md:text-7xl font-extrabold text-[#fafafa] leading-[1.1] tracking-tight"
          style={font.display}
          initial={{ opacity: 0, y: 20 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ ...ease, delay: 0.1 }}
        >
          Self-Hosting with
          <br />
          <span className="text-[#7c3aed]">Superpowers</span>
        </motion.h1>

        <motion.p
          className="mt-6 text-lg text-[#a1a1aa] max-w-2xl mx-auto leading-relaxed"
          style={{ ...font.body, fontWeight: 400 }}
          initial={{ opacity: 0, y: 15 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ ...ease, delay: 0.25 }}
        >
          Run your entire infrastructure on your own servers. Full control,
          zero vendor lock-in, predictable costs.
        </motion.p>

        <motion.div
          className="mt-8"
          initial={{ opacity: 0, y: 10 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ ...ease, delay: 0.35 }}
        >
          <button
            onClick={handleCopy}
            className="w-full max-w-lg mx-auto flex items-center justify-between px-5 py-3 rounded-xl border border-white/[0.08] bg-[#18181b] hover:border-[#7c3aed]/40 transition-colors group"
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
          transition={{ ...ease, delay: 0.45 }}
        >
          <a
            href="#cta"
            className="px-6 py-2.5 text-sm font-semibold rounded-lg bg-[#7c3aed] text-white hover:bg-[#6d28d9] transition-colors inline-flex items-center gap-2"
            style={font.display}
          >
            Self-Host Now <ArrowRight size={16} />
          </a>
          <a
            href="#"
            className="px-6 py-2.5 text-sm font-semibold rounded-lg border border-white/[0.08] text-[#fafafa] hover:border-white/[0.15] transition-colors"
            style={font.display}
          >
            Try Cloud
          </a>
        </motion.div>

        <IsometricDiagram />
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
    <section ref={ref} className="relative z-10 border-t border-b border-white/[0.08]">
      <div className="max-w-5xl mx-auto grid grid-cols-2 md:grid-cols-4">
        {STATS.map((stat, i) => (
          <motion.div
            key={stat.label}
            className={`py-10 px-6 text-center ${
              i < STATS.length - 1 ? "md:border-r md:border-white/[0.08]" : ""
            } ${i % 2 === 0 && i < 2 ? "border-r border-white/[0.08] md:border-r" : ""}`}
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
// Why Self-Host
// ---------------------------------------------------------------------------

const WHY_CARDS = [
  {
    icon: <Lock size={20} />,
    title: "Data Sovereignty",
    description: "Your data never leaves your servers. Full control over where and how your data is stored, processed, and accessed.",
  },
  {
    icon: <DollarSign size={20} />,
    title: "Predictable Costs",
    description: "Pay for servers, not per-seat SaaS pricing. No surprise bills, no usage-based surcharges, no hidden fees.",
  },
  {
    icon: <Code2 size={20} />,
    title: "Full Customization",
    description: "Modify anything. It's open source. Add custom deploy hooks, integrations, and workflows tailored to your team.",
  },
  {
    icon: <Shield size={20} />,
    title: "Compliance Ready",
    description: "GDPR, HIPAA, SOC 2 -- on your terms. Meet regulatory requirements without depending on third-party attestations.",
  },
];

function WhySelfHost() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });

  return (
    <section ref={ref} className="relative z-10 py-24 px-5">
      <div className="max-w-5xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={ease}
          className="mb-12"
        >
          <h2
            className="text-4xl font-bold text-[#fafafa] tracking-tight"
            style={font.display}
          >
            Take back control of your infrastructure
          </h2>
          <p
            className="mt-2 text-xl font-semibold text-[#a1a1aa]"
            style={font.display}
          >
            -- no more surprise bills, no more vendor lock-in.
          </p>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {WHY_CARDS.map((card, i) => (
            <motion.div
              key={card.title}
              className="rounded-xl border border-white/[0.08] bg-zinc-900/50 p-6 hover:border-[#7c3aed]/30 transition-colors"
              initial={{ opacity: 0, y: 15 }}
              animate={inView ? { opacity: 1, y: 0 } : {}}
              transition={{ ...ease, delay: 0.08 * i }}
            >
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-lg bg-[#7c3aed]/10 border border-[#7c3aed]/20 flex items-center justify-center text-[#a78bfa]">
                  {card.icon}
                </div>
                <h3
                  className="text-lg font-semibold text-[#fafafa]"
                  style={font.display}
                >
                  {card.title}
                </h3>
              </div>
              <p
                className="text-sm text-[#a1a1aa] leading-relaxed"
                style={font.body}
              >
                {card.description}
              </p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Bento Grid -- Self-Hosting Features
// ---------------------------------------------------------------------------

function BentoGrid() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });

  const platforms = ["AWS", "GCP", "Azure", "DigitalOcean", "Hetzner", "Bare Metal"];

  return (
    <section id="features" ref={ref} className="relative z-10 py-24 px-5">
      <div className="max-w-5xl mx-auto">
        <motion.h2
          className="text-4xl font-bold text-[#fafafa] tracking-tight mb-10"
          style={font.display}
          initial={{ opacity: 0, y: 15 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={ease}
        >
          Everything you need to self-host
        </motion.h2>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          {/* Run Anywhere -- col-span-2 */}
          <motion.div
            className="md:col-span-2 rounded-xl border border-white/[0.08] bg-zinc-900/50 p-6 hover:border-[#7c3aed]/30 transition-colors"
            initial={{ opacity: 0, scale: 0.97 }}
            animate={inView ? { opacity: 1, scale: 1 } : {}}
            transition={{ ...ease, delay: 0.05 }}
          >
            <div className="flex items-center gap-2 mb-2">
              <Globe size={18} className="text-[#7c3aed]" />
              <h3 className="text-base font-semibold text-[#fafafa]" style={font.display}>
                Run Anywhere
              </h3>
            </div>
            <p className="text-sm text-[#a1a1aa] mb-4 leading-relaxed" style={font.body}>
              Any cloud, any server, any OS. Deploy on the infrastructure you already have.
            </p>
            <div className="flex flex-wrap gap-2">
              {platforms.map((p) => (
                <span
                  key={p}
                  className="px-3 py-1.5 rounded-md text-xs font-medium bg-[#18181b] text-[#a1a1aa] border border-white/[0.08]"
                  style={font.mono}
                >
                  {p}
                </span>
              ))}
            </div>
          </motion.div>

          {/* Docker Native -- 1x1 */}
          <motion.div
            className="rounded-xl border border-white/[0.08] bg-zinc-900/50 p-6 hover:border-[#7c3aed]/30 transition-colors"
            initial={{ opacity: 0, scale: 0.97 }}
            animate={inView ? { opacity: 1, scale: 1 } : {}}
            transition={{ ...ease, delay: 0.1 }}
          >
            <div className="flex items-center gap-2 mb-2">
              <HardDrive size={18} className="text-[#7c3aed]" />
              <h3 className="text-base font-semibold text-[#fafafa]" style={font.display}>
                Docker Native
              </h3>
            </div>
            <p className="text-sm text-[#a1a1aa] mb-3 leading-relaxed" style={font.body}>
              Built on Docker and Docker Compose.
            </p>
            <div className="rounded-lg bg-[#111111] border border-white/[0.06] p-3">
              <div className="text-[11px] text-[#71717a]" style={font.mono}>
                <div className="text-[#a78bfa]">$ docker compose up -d</div>
                <div className="text-[#4ade80] mt-1">{"\u2713"} 4 containers running</div>
              </div>
            </div>
          </motion.div>

          {/* One-Click Install -- 1x1 */}
          <motion.div
            className="rounded-xl border border-white/[0.08] bg-zinc-900/50 p-6 hover:border-[#7c3aed]/30 transition-colors"
            initial={{ opacity: 0, scale: 0.97 }}
            animate={inView ? { opacity: 1, scale: 1 } : {}}
            transition={{ ...ease, delay: 0.15 }}
          >
            <div className="flex items-center gap-2 mb-2">
              <Terminal size={18} className="text-[#7c3aed]" />
              <h3 className="text-base font-semibold text-[#fafafa]" style={font.display}>
                One-Click Install
              </h3>
            </div>
            <p className="text-sm text-[#a1a1aa] mb-3 leading-relaxed" style={font.body}>
              curl | sh and you're done.
            </p>
            <div className="rounded-lg bg-[#111111] border border-white/[0.06] p-3">
              <div className="text-[11px] text-[#a78bfa] truncate" style={font.mono}>
                $ curl -fsSL get.otterdeploy.sh | sh
              </div>
            </div>
          </motion.div>

          {/* Automatic SSL -- col-span-2 */}
          <motion.div
            className="md:col-span-2 rounded-xl border border-white/[0.08] bg-zinc-900/50 p-6 hover:border-[#7c3aed]/30 transition-colors"
            initial={{ opacity: 0, scale: 0.97 }}
            animate={inView ? { opacity: 1, scale: 1 } : {}}
            transition={{ ...ease, delay: 0.2 }}
          >
            <div className="flex items-center gap-2 mb-2">
              <Lock size={18} className="text-[#7c3aed]" />
              <h3 className="text-base font-semibold text-[#fafafa]" style={font.display}>
                Automatic SSL
              </h3>
              <span
                className="ml-auto px-2 py-0.5 rounded text-[10px] font-medium bg-[#7c3aed]/10 text-[#a78bfa]"
                style={font.mono}
              >
                Let's Encrypt
              </span>
            </div>
            <p className="text-sm text-[#a1a1aa] mb-4 leading-relaxed" style={font.body}>
              Automatic certificate provisioning and renewal. HTTPS everywhere, zero configuration.
            </p>
            <div className="rounded-lg bg-[#111111] border border-white/[0.06] p-3">
              <div className="text-[11px] leading-relaxed" style={font.mono}>
                <div className="text-[#71717a]">$ otter certs --list</div>
                <div className="text-[#4ade80] mt-1">{"\u2713"} app.mycompany.com    expires: 89 days</div>
                <div className="text-[#4ade80]">{"\u2713"} api.mycompany.com    expires: 89 days</div>
                <div className="text-[#71717a] mt-1">Auto-renewal: enabled</div>
              </div>
            </div>
          </motion.div>

          {/* Backup & Restore -- 1x1 */}
          <motion.div
            className="rounded-xl border border-white/[0.08] bg-zinc-900/50 p-6 hover:border-[#7c3aed]/30 transition-colors"
            initial={{ opacity: 0, scale: 0.97 }}
            animate={inView ? { opacity: 1, scale: 1 } : {}}
            transition={{ ...ease, delay: 0.25 }}
          >
            <div className="flex items-center gap-2 mb-2">
              <Database size={18} className="text-[#7c3aed]" />
              <h3 className="text-base font-semibold text-[#fafafa]" style={font.display}>
                Backup & Restore
              </h3>
            </div>
            <p className="text-sm text-[#a1a1aa] leading-relaxed" style={font.body}>
              Automated database backups with point-in-time recovery. Schedule daily, hourly, or on-demand.
            </p>
          </motion.div>

          {/* Monitoring -- 1x1 */}
          <motion.div
            className="rounded-xl border border-white/[0.08] bg-zinc-900/50 p-6 hover:border-[#7c3aed]/30 transition-colors"
            initial={{ opacity: 0, scale: 0.97 }}
            animate={inView ? { opacity: 1, scale: 1 } : {}}
            transition={{ ...ease, delay: 0.3 }}
          >
            <div className="flex items-center gap-2 mb-2">
              <Activity size={18} className="text-[#7c3aed]" />
              <h3 className="text-base font-semibold text-[#fafafa]" style={font.display}>
                Monitoring
              </h3>
            </div>
            <p className="text-sm text-[#a1a1aa] leading-relaxed" style={font.body}>
              Built-in metrics, real-time alerts, and health dashboards. Know the state of your infra at a glance.
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
  const [activeTab, setActiveTab] = useState<TabKey>("install");

  const tabIcons: Record<TabKey, React.ReactNode> = {
    install: <Terminal size={16} />,
    configure: <Server size={16} />,
    deploy: <ArrowRight size={16} />,
    monitor: <Activity size={16} />,
  };

  const data = FEATURE_TABS[activeTab];

  return (
    <section
      ref={ref}
      className="relative z-10 py-24 px-5"
      style={{
        background: `radial-gradient(ellipse at 50% 0%, rgba(124,58,237,0.18) 0%, transparent 60%),
                     radial-gradient(ellipse at 80% 60%, rgba(167,139,250,0.08) 0%, transparent 50%),
                     transparent`,
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
          From install to production
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
                  return <div key={i} className="text-[#71717a]">{line}</div>;
                }
                if (line.startsWith("$")) {
                  return <div key={i} className="text-[#fafafa]">{line}</div>;
                }
                if (line.startsWith("\u25B8")) {
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
                if (line.includes(":") && !line.startsWith(" ") && !line.startsWith("\u2192")) {
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
// Community Testimonials
// ---------------------------------------------------------------------------

function Community() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });

  return (
    <section ref={ref} className="relative z-10 py-24 px-5">
      <div className="max-w-5xl mx-auto">
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
            Trusted by teams who self-host
          </h2>
          <p className="mt-3 text-base text-[#a1a1aa]" style={font.body}>
            Real stories from teams who took back control.
          </p>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {TESTIMONIALS.map((t, i) => (
            <motion.div
              key={t.name}
              className="rounded-xl border border-white/[0.08] bg-zinc-900/50 p-6"
              initial={{ opacity: 0, y: 15 }}
              animate={inView ? { opacity: 1, y: 0 } : {}}
              transition={{ ...ease, delay: 0.1 * i }}
            >
              <Quote size={18} className="text-[#7c3aed]/40 mb-3" />
              <p
                className="text-sm text-[#a1a1aa] leading-relaxed mb-5"
                style={font.body}
              >
                "{t.text}"
              </p>
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-[#7c3aed]/10 border border-[#7c3aed]/20 flex items-center justify-center">
                  <span className="text-[10px] font-medium text-[#a78bfa]" style={font.mono}>
                    {t.initials}
                  </span>
                </div>
                <div>
                  <div className="text-sm font-semibold text-[#fafafa]" style={font.display}>
                    {t.name}
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
// Comparison: Self-hosted vs Cloud PaaS
// ---------------------------------------------------------------------------

const COMPARISON_ITEMS = [
  { label: "Vendor lock-in", cloud: true, self: false, selfLabel: "Full ownership" },
  { label: "Unpredictable costs", cloud: true, self: false, selfLabel: "Predictable costs" },
  { label: "Data on someone else's servers", cloud: true, self: false, selfLabel: "Data sovereignty" },
  { label: "Limited customization", cloud: true, self: false, selfLabel: "Unlimited customization" },
];

function Comparison() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });

  return (
    <section ref={ref} className="relative z-10 py-24 px-5">
      <div className="max-w-4xl mx-auto">
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
            Self-hosted vs. Cloud PaaS
          </h2>
        </motion.div>

        <motion.div
          className="grid grid-cols-1 md:grid-cols-2 gap-6"
          initial={{ opacity: 0, y: 15 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ ...ease, delay: 0.1 }}
        >
          {/* Cloud PaaS Column */}
          <div className="rounded-xl border border-white/[0.08] bg-zinc-900/30 p-6">
            <div className="flex items-center gap-2 mb-5">
              <Cloud size={18} className="text-[#71717a]" />
              <h3 className="text-lg font-semibold text-[#71717a]" style={font.display}>
                Cloud PaaS
              </h3>
            </div>
            <div className="flex flex-col gap-4">
              {COMPARISON_ITEMS.map((item) => (
                <div key={item.label} className="flex items-center gap-3">
                  <div className="w-6 h-6 rounded-full bg-red-500/10 flex items-center justify-center shrink-0">
                    <X size={12} className="text-red-400" />
                  </div>
                  <span className="text-sm text-[#71717a]" style={font.body}>
                    {item.label}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Self-hosted Column */}
          <div className="rounded-xl border border-[#7c3aed]/30 bg-[#7c3aed]/5 p-6">
            <div className="flex items-center gap-2 mb-5">
              <Server size={18} className="text-[#a78bfa]" />
              <h3 className="text-lg font-semibold text-[#fafafa]" style={font.display}>
                Self-hosted Otterdeploy
              </h3>
            </div>
            <div className="flex flex-col gap-4">
              {COMPARISON_ITEMS.map((item) => (
                <div key={item.selfLabel} className="flex items-center gap-3">
                  <div className="w-6 h-6 rounded-full bg-[#4ade80]/10 flex items-center justify-center shrink-0">
                    <Check size={12} className="text-[#4ade80]" />
                  </div>
                  <span className="text-sm text-[#fafafa]" style={font.body}>
                    {item.selfLabel}
                  </span>
                </div>
              ))}
            </div>
          </div>
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
    <section ref={ref} className="relative z-10 py-24 px-5">
      <div className="max-w-5xl mx-auto">
        <motion.div
          className="text-center mb-10"
          initial={{ opacity: 0, y: 15 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={ease}
        >
          <h2
            className="text-3xl font-bold text-[#fafafa] tracking-tight"
            style={font.display}
          >
            Self-hosted is free. Forever.
          </h2>
          <p className="mt-2 text-base text-[#a1a1aa]" style={font.body}>
            Pay only for the servers you run. The platform itself costs nothing.
          </p>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {/* Self-Hosted */}
          <motion.div
            className="rounded-xl border-2 border-[#7c3aed] bg-[#7c3aed]/5 p-8"
            initial={{ opacity: 0, y: 15 }}
            animate={inView ? { opacity: 1, y: 0 } : {}}
            transition={{ ...ease, delay: 0.05 }}
          >
            <span
              className="text-xs text-[#a78bfa] uppercase tracking-wider font-medium"
              style={font.mono}
            >
              Self-Hosted
            </span>
            <div className="text-4xl font-bold text-[#fafafa] mt-2" style={font.display}>
              Free
            </div>
            <p className="text-sm text-[#a1a1aa] mt-2 leading-relaxed" style={font.body}>
              All features, unlimited servers, unlimited deployments. Run on your own hardware.
            </p>
            <div className="mt-5 flex flex-col gap-2.5">
              {[
                "Unlimited deployments",
                "Unlimited servers",
                "Automatic SSL",
                "Built-in monitoring",
                "Database backups",
                "Community support",
              ].map((f) => (
                <div key={f} className="flex items-center gap-2">
                  <Check size={14} className="text-[#4ade80]" />
                  <span className="text-xs text-[#a1a1aa]" style={font.body}>
                    {f}
                  </span>
                </div>
              ))}
            </div>
          </motion.div>

          {/* Cloud */}
          <motion.div
            className="rounded-xl border border-white/[0.08] bg-zinc-900/50 p-8 hover:border-[#7c3aed]/30 transition-colors"
            initial={{ opacity: 0, y: 15 }}
            animate={inView ? { opacity: 1, y: 0 } : {}}
            transition={{ ...ease, delay: 0.1 }}
          >
            <span
              className="text-xs text-[#71717a] uppercase tracking-wider"
              style={font.mono}
            >
              Cloud
            </span>
            <div className="mt-2">
              <span className="text-4xl font-bold text-[#fafafa]" style={font.display}>
                $19
              </span>
              <span className="text-sm text-[#71717a] ml-1">/mo</span>
            </div>
            <p className="text-sm text-[#a1a1aa] mt-2 leading-relaxed" style={font.body}>
              We host it for you. Managed infrastructure with zero maintenance.
            </p>
            <div className="mt-5 flex flex-col gap-2.5">
              {[
                "Everything in Self-Hosted",
                "Managed infrastructure",
                "Automatic updates",
                "Priority support",
              ].map((f) => (
                <div key={f} className="flex items-center gap-2">
                  <Check size={14} className="text-[#7c3aed]" />
                  <span className="text-xs text-[#a1a1aa]" style={font.body}>
                    {f}
                  </span>
                </div>
              ))}
            </div>
          </motion.div>

          {/* Enterprise */}
          <motion.div
            className="rounded-xl border border-white/[0.08] bg-zinc-900/50 p-8 hover:border-[#7c3aed]/30 transition-colors"
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
            <div className="text-4xl font-bold text-[#fafafa] mt-2" style={font.display}>
              Custom
            </div>
            <p className="text-sm text-[#a1a1aa] mt-2 leading-relaxed" style={font.body}>
              SLA guarantees, dedicated support, custom integrations, and compliance assistance.
            </p>
            <div className="mt-5 flex flex-col gap-2.5">
              {[
                "Everything in Cloud",
                "SLA guarantee",
                "Dedicated support engineer",
                "Custom integrations",
              ].map((f) => (
                <div key={f} className="flex items-center gap-2">
                  <Check size={14} className="text-[#7c3aed]" />
                  <span className="text-xs text-[#a1a1aa]" style={font.body}>
                    {f}
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
      className="relative z-10 py-28 px-5"
      style={{
        background: `radial-gradient(ellipse at 50% 20%, rgba(124,58,237,0.25) 0%, transparent 60%),
                     radial-gradient(ellipse at 30% 80%, rgba(167,139,250,0.1) 0%, transparent 50%),
                     transparent`,
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
          Take back control
        </motion.h2>

        <motion.p
          className="mt-4 text-lg text-[#a1a1aa]"
          style={font.body}
          initial={{ opacity: 0, y: 10 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ ...ease, delay: 0.1 }}
        >
          Your servers. Your data. Your rules. Start self-hosting in under 5 minutes.
        </motion.p>

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
          className="mt-8 flex items-center justify-center gap-3"
          initial={{ opacity: 0 }}
          animate={inView ? { opacity: 1 } : {}}
          transition={{ ...ease, delay: 0.3 }}
        >
          <a
            href="#"
            className="px-6 py-2.5 rounded-lg bg-[#7c3aed] text-white text-sm font-semibold hover:bg-[#6d28d9] transition-colors inline-flex items-center gap-2"
            style={font.display}
          >
            <Server size={16} /> Self-Host Now
          </a>
          <a
            href="#"
            className="px-6 py-2.5 rounded-lg border border-white/[0.08] text-[#fafafa] text-sm font-semibold hover:border-white/[0.15] transition-colors inline-flex items-center gap-2"
            style={font.display}
          >
            <Github size={16} /> Star on GitHub
          </a>
        </motion.div>

        <motion.span
          className="inline-block mt-6 text-xs text-[#71717a]"
          style={font.mono}
          initial={{ opacity: 0 }}
          animate={inView ? { opacity: 1 } : {}}
          transition={{ ...ease, delay: 0.4 }}
        >
          Free &middot; Open Source &middot; MIT Licensed
        </motion.span>
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
      title: "Self-Host",
      links: ["Installation", "Configuration", "Migration", "Backups"],
    },
    {
      title: "Company",
      links: ["About", "Blog", "Pricing", "Security"],
    },
  ];

  return (
    <footer className="relative z-10 px-5 py-12 border-t border-white/[0.08]">
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
              Self-hosted PaaS with superpowers.
            </p>
            <div className="flex items-center gap-3 mt-4">
              <a href="#" className="text-[#71717a] hover:text-[#a1a1aa] transition-colors">
                <Github size={16} />
              </a>
            </div>
            <div className="flex items-center gap-1 mt-4">
              {VARIANT_LINKS.map((v) => (
                <Link
                  key={v.to}
                  to={v.to}
                  className={`w-6 h-6 flex items-center justify-center text-xs rounded transition-colors ${
                    v.to === "/15"
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
            &copy; 2026 otterdeploy &middot; MIT License
          </span>
          <span
            className="text-xs text-[#71717a] inline-flex items-center gap-1"
            style={font.mono}
          >
            self-hosted with <Heart size={10} className="text-[#7c3aed]" /> by the community
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
    <div className="bg-[#09090b] text-[#fafafa] min-h-screen relative" style={font.body}>
      <DotGridBackground />
      <Nav />
      <Hero />
      <StatsRow />
      <WhySelfHost />
      <BentoGrid />
      <FeatureTabs />
      <Community />
      <Comparison />
      <Pricing />
      <CTA />
      <Footer />
    </div>
  );
}
