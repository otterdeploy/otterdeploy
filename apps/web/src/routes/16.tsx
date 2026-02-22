import { createFileRoute, Link } from "@tanstack/react-router";
import { motion, useInView } from "motion/react";
import { useEffect, useRef, useState } from "react";
import {
  Github,
  ArrowRight,
  Copy,
  Check,
  Heart,
  MessageCircle,
  Star,
  Quote,
  Rocket,
  Database,
  Server,
  Lock,
  Activity,
  GitBranch,
  Puzzle,
} from "lucide-react";

export const Route = createFileRoute("/16")({
  component: RouteComponent,
});

// ---------------------------------------------------------------------------
// Font Loader
// ---------------------------------------------------------------------------

function useFonts() {
  useEffect(() => {
    const id = "dark-paas-community-fonts";
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

const SATELLITE_NODES = [
  { label: ".WEB", x: -100, y: -40 },
  { label: ".API", x: 230, y: -50 },
  { label: ".DB", x: 250, y: 80 },
  { label: ".CACHE", x: -110, y: 90 },
  { label: ".WORKER", x: 70, y: 200 },
];

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

// Animated terminal lines for the deploy demo
const DEPLOY_LINES = [
  { text: "$ curl -fsSL https://get.otterdeploy.sh | sh", type: "command" as const },
  { text: "", type: "blank" as const },
  { text: "otterdeploy v2.4.0 \u2014 installing...", type: "brand" as const },
  { text: "", type: "blank" as const },
  { text: "\u2192 Downloading binary...", type: "header" as const },
  { text: "  \u2713 otterdeploy-linux-amd64   4.2MB", type: "success" as const },
  { text: "  \u2713 Binary installed to /usr/local/bin", type: "success" as const },
  { text: "", type: "blank" as const },
  { text: "\u2192 Bootstrapping platform...", type: "header" as const },
  { text: "  \u2713 Docker daemon    Connected", type: "success" as const },
  { text: "  \u2713 PostgreSQL       Running", type: "success" as const },
  { text: "  \u2713 Redis            Running", type: "success" as const },
  { text: "  \u2713 Caddy          \u2192 https://deploy.myserver.com", type: "success" as const },
  { text: "  \u2713 SSL certificates \u2192 Let's Encrypt (auto)", type: "success" as const },
  { text: "", type: "blank" as const },
  { text: "\u2713 Platform ready! Dashboard at https://deploy.myserver.com", type: "final" as const },
];

const FEATURE_TABS = [
  {
    key: "deploy",
    label: "deploy",
    icon: <Rocket size={16} />,
    heading: "Flexible Application Deployment",
    desc: "Deploy any application using Nixpacks, Heroku Buildpacks, or your custom Dockerfile, tailored to your stack.",
    bullets: [
      "Nixpacks auto-detection for Node, Python, Go, Rust, PHP, Ruby, Java, .NET",
      "Full Dockerfile support for custom build pipelines",
      "Docker Compose native for multi-service orchestration",
      "Heroku Buildpacks compatibility for easy migration",
    ],
    terminal: {
      title: "deploy.sh",
      lines: [
        { text: "$ otter deploy ./myapp", type: "command" },
        { text: "", type: "blank" },
        { text: "\u2192 Detecting runtime...", type: "header" },
        { text: "  \u2713 Detected: Node.js 20 (via Nixpacks)", type: "success" },
        { text: "  \u2713 Dependencies installed (8s)", type: "success" },
        { text: "  \u2713 Build complete (12s)", type: "success" },
        { text: "", type: "blank" },
        { text: "\u2192 Deploying to production...", type: "header" },
        { text: "  \u2713 Container started", type: "success" },
        { text: "  \u2713 Health check passed", type: "success" },
        { text: "  \u2713 Traffic routed \u2192 myapp.com", type: "success" },
        { text: "", type: "blank" },
        { text: "\u2713 Deploy complete! (22s)", type: "final" },
      ],
    },
  },
  {
    key: "git",
    label: "git push",
    icon: <GitBranch size={16} />,
    heading: "Push to Deploy",
    desc: "Connect your Git repository and every push triggers an automatic build and zero-downtime deployment. Preview environments for every pull request.",
    bullets: [
      "GitHub, GitLab, Bitbucket, and Gitea integration",
      "Automatic builds triggered on every push",
      "PR preview environments with unique URLs",
      "Instant rollbacks to any previous deployment",
    ],
    terminal: {
      title: "git-deploy.sh",
      lines: [
        { text: "$ git push origin main", type: "command" },
        { text: "", type: "blank" },
        { text: "\u25b8 Webhook received from GitHub", type: "metric" },
        { text: "\u25b8 Build #1248 triggered", type: "metric" },
        { text: "", type: "blank" },
        { text: "\u2192 Building...", type: "header" },
        { text: "  \u2713 web        Built in 8s", type: "success" },
        { text: "  \u2713 api        Built in 5s", type: "success" },
        { text: "", type: "blank" },
        { text: "\u2192 Rolling deploy (zero downtime)...", type: "header" },
        { text: "  \u2713 web        \u2192 myapp.com", type: "success" },
        { text: "  \u2713 api        \u2192 api.myapp.com", type: "success" },
        { text: "", type: "blank" },
        { text: "\u2713 Production live! Build #1248 (18s)", type: "final" },
      ],
    },
  },
  {
    key: "monitor",
    label: "monitor",
    icon: <Activity size={16} />,
    heading: "Real-time Monitoring & Logs",
    desc: "Monitor your entire stack from a single pane. Live log streaming, health checks, resource metrics, and alerting across all your services.",
    bullets: [
      "Live log streaming across all services",
      "CPU, memory, disk, and network metrics in real-time",
      "Health check dashboards with uptime tracking",
      "Notifications via Slack, Discord, Telegram, and email",
    ],
    terminal: {
      title: "monitor.sh",
      lines: [
        { text: "$ otter logs --tail --service api", type: "command" },
        { text: "", type: "blank" },
        { text: "[12:04:01] 200 GET  /health       2ms", type: "log" },
        { text: "[12:04:03] 200 POST /api/users   18ms", type: "log" },
        { text: "[12:04:05] 200 GET  /api/items    4ms", type: "log" },
        { text: "[12:04:06] 201 POST /api/deploy  42ms", type: "log" },
        { text: "[12:04:08] 200 GET  /api/status   1ms", type: "log" },
        { text: "", type: "blank" },
        { text: "\u25b8 cpu: 23%  mem: 412MB  req/s: 1.2k", type: "metric" },
        { text: "\u25b8 uptime: 99.99%  p99: 48ms", type: "metric" },
      ],
    },
  },
  {
    key: "backup",
    label: "backup",
    icon: <Database size={16} />,
    heading: "Database Management & Backups",
    desc: "Manage and back up all your databases directly. Scheduled backups to S3-compatible storage with one-click restore.",
    bullets: [
      "PostgreSQL, MySQL, MongoDB, MariaDB, and Redis support",
      "Scheduled automatic backups to any S3-compatible storage",
      "One-click database restore from any backup point",
      "Connection pooling and resource management built in",
    ],
    terminal: {
      title: "backup.sh",
      lines: [
        { text: "$ otter db backup --all", type: "command" },
        { text: "", type: "blank" },
        { text: "\u2192 Creating backups...", type: "header" },
        { text: "  \u2713 postgres    42MB  \u2192 s3://backups/pg-2026-02-22.sql.gz", type: "success" },
        { text: "  \u2713 redis       8MB   \u2192 s3://backups/redis-2026-02-22.rdb", type: "success" },
        { text: "  \u2713 mongodb     126MB \u2192 s3://backups/mongo-2026-02-22.gz", type: "success" },
        { text: "", type: "blank" },
        { text: "\u2713 All databases backed up successfully", type: "final" },
        { text: "\u25b8 Next scheduled: 2026-02-23 03:00 UTC", type: "metric" },
      ],
    },
  },
  {
    key: "scale",
    label: "scale",
    icon: <Server size={16} />,
    heading: "Multi-Server & Scaling",
    desc: "Deploy across multiple servers with Docker Swarm. Scale horizontally with a single command as your traffic grows.",
    bullets: [
      "Docker Swarm clustering for multi-node deployments",
      "Horizontal auto-scaling based on CPU/memory thresholds",
      "Load balancer configuration with Caddy",
      "Resource limits and quotas per service",
    ],
    terminal: {
      title: "scale.sh",
      lines: [
        { text: "$ otter scale web --replicas 4", type: "command" },
        { text: "", type: "blank" },
        { text: "\u2192 Scaling web: 2 \u2192 4 replicas", type: "header" },
        { text: "  \u2713 replica-1   Running  (node-1)", type: "success" },
        { text: "  \u2713 replica-2   Running  (node-1)", type: "success" },
        { text: "  \u2713 replica-3   Running  (node-2)", type: "success" },
        { text: "  \u2713 replica-4   Running  (node-2)", type: "success" },
        { text: "  \u2713 Load balancer updated", type: "success" },
        { text: "", type: "blank" },
        { text: "\u2713 web scaled to 4 replicas across 2 nodes", type: "final" },
        { text: "\u25b8 avg cpu: 34% \u2192 18%  avg mem: 380MB \u2192 210MB", type: "metric" },
      ],
    },
  },
  {
    key: "ssl",
    label: "ssl",
    icon: <Lock size={16} />,
    heading: "SSL, Domains & Caddy",
    desc: "Automatic TLS certificates via Let's Encrypt for every service. Domain management and reverse proxy powered by Caddy.",
    bullets: [
      "Automatic Let's Encrypt SSL with auto-renewal",
      "Custom domain mapping per service",
      "Caddy reverse proxy with automatic routing",
      "Wildcard certificates and multi-domain support",
    ],
    terminal: {
      title: "domains.sh",
      lines: [
        { text: "$ otter domains add myapp.com --service web", type: "command" },
        { text: "", type: "blank" },
        { text: "\u2192 Configuring domain...", type: "header" },
        { text: "  \u2713 DNS verified for myapp.com", type: "success" },
        { text: "  \u2713 SSL certificate issued (Let's Encrypt)", type: "success" },
        { text: "  \u2713 Caddy route configured", type: "success" },
        { text: "  \u2713 HTTPS redirect enabled", type: "success" },
        { text: "", type: "blank" },
        { text: "\u2713 myapp.com \u2192 web:3000 (TLS active)", type: "final" },
        { text: "\u25b8 Cert expires: 2026-05-22 (auto-renew)", type: "metric" },
      ],
    },
  },
  {
    key: "templates",
    label: "templates",
    icon: <Puzzle size={16} />,
    heading: "One-Click Service Templates",
    desc: "Get started quickly with 120+ pre-configured templates for popular tools. Deploy production-ready services in seconds.",
    bullets: [
      "Supabase, PocketBase, Appwrite, and more",
      "Cal.com, Plausible, Umami analytics",
      "Ghost, WordPress, Strapi CMS",
      "MinIO, Grafana, Prometheus, and 100+ more",
    ],
    terminal: {
      title: "templates.sh",
      lines: [
        { text: "$ otter template list", type: "command" },
        { text: "", type: "blank" },
        { text: "  supabase       Backend-as-a-Service      \u2605 4.2k", type: "log" },
        { text: "  pocketbase     Lightweight BaaS           \u2605 3.1k", type: "log" },
        { text: "  plausible      Privacy-first analytics    \u2605 2.8k", type: "log" },
        { text: "  ghost          Publishing platform        \u2605 2.4k", type: "log" },
        { text: "  grafana        Observability platform     \u2605 1.9k", type: "log" },
        { text: "", type: "blank" },
        { text: "  ... and 115 more templates", type: "metric" },
        { text: "", type: "blank" },
        { text: "$ otter template deploy supabase", type: "command" },
        { text: "\u2713 Supabase deployed at supabase.myserver.com", type: "final" },
      ],
    },
  },
];

const CONTRIBUTOR_AVATARS = [
  { initials: "SK", color: "#7c3aed" },
  { initials: "MJ", color: "#2563eb" },
  { initials: "JD", color: "#059669" },
  { initials: "AR", color: "#d97706" },
  { initials: "LP", color: "#dc2626" },
  { initials: "NW", color: "#7c3aed" },
  { initials: "TH", color: "#2563eb" },
  { initials: "RG", color: "#059669" },
  { initials: "CM", color: "#d97706" },
  { initials: "YB", color: "#dc2626" },
  { initials: "EF", color: "#7c3aed" },
  { initials: "OQ", color: "#2563eb" },
  { initials: "DK", color: "#059669" },
  { initials: "PL", color: "#d97706" },
  { initials: "WS", color: "#dc2626" },
  { initials: "HM", color: "#7c3aed" },
  { initials: "ZA", color: "#2563eb" },
  { initials: "BT", color: "#059669" },
];

const TESTIMONIALS = [
  {
    quote:
      "We migrated from Heroku to Otterdeploy in 15 minutes. Cut our hosting bill by 80% and now we own our entire stack. The one-command install is genuinely that simple.",
    author: "Priya M.",
    role: "DevOps Engineer, Startly",
  },
  {
    quote:
      "Finally, self-hosted infrastructure I can actually version control. The declarative YAML config and push-to-deploy workflow means our team ships faster without the PaaS tax.",
    author: "Alex R.",
    role: "CTO, Shipfast",
  },
  {
    quote:
      "The plugin system is brilliant. Built a custom deploy hook in an afternoon, upstream'd it the next day. 42 contributors and growing \u2014 that's the power of open source.",
    author: "Tom H.",
    role: "Platform Engineer",
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
          <div className="w-3 h-3 rounded-full bg-[#ff5f57]" />
          <div className="w-3 h-3 rounded-full bg-[#febc2e]" />
          <div className="w-3 h-3 rounded-full bg-[#28c840]" />
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

// Renders a single terminal line with syntax highlighting
function TerminalLine({ line }: { line: { text: string; type: string } }) {
  switch (line.type) {
    case "command":
      return <span className="text-[#fafafa]">{line.text}</span>;
    case "blank":
      return <br />;
    case "brand":
      return <span className="text-[#a78bfa]">{line.text}</span>;
    case "header":
      return <span className="text-[#fafafa]">{line.text}</span>;
    case "comment":
      return <span className="text-[#71717a]">{line.text}</span>;
    case "yaml": {
      if (line.text.includes(":")) {
        const colonIdx = line.text.indexOf(":");
        return (
          <span>
            <span className="text-[#a78bfa]">{line.text.slice(0, colonIdx + 1)}</span>
            <span className="text-[#fafafa]">{line.text.slice(colonIdx + 1)}</span>
          </span>
        );
      }
      return <span className="text-[#fafafa]">{line.text}</span>;
    }
    case "success": {
      const text = line.text;
      return (
        <span>
          <span className="text-[#4ade80]">
            {text.slice(0, text.indexOf("\u2713") + 1)}
          </span>
          <span className="text-[#fafafa]">
            {text.slice(text.indexOf("\u2713") + 1).split("\u2192")[0]}
          </span>
          {text.includes("\u2192") && (
            <>
              <span className="text-[#71717a]">{"\u2192 "}</span>
              <span className="text-[#a78bfa]">
                {text.split("\u2192")[1].trim()}
              </span>
            </>
          )}
        </span>
      );
    }
    case "final":
      return <span className="text-[#4ade80] font-medium">{line.text}</span>;
    case "log":
      return <span className="text-[#a1a1aa]">{line.text}</span>;
    case "metric":
      return <span className="text-[#fafafa]">{line.text}</span>;
    default:
      return <span className="text-[#fafafa]">{line.text || "\u00a0"}</span>;
  }
}

// ---------------------------------------------------------------------------
// Dot Grid + Aurora Background
// ---------------------------------------------------------------------------

function DotGridBackground() {
  return (
    <div className="fixed inset-0 pointer-events-none z-0">
      <div
        className="absolute inset-0"
        style={{
          backgroundImage:
            "radial-gradient(circle, rgba(255,255,255,0.04) 1px, transparent 1px)",
          backgroundSize: "24px 24px",
        }}
      />
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse at 20% 0%, rgba(124,58,237,0.15) 0%, transparent 50%), radial-gradient(ellipse at 80% 20%, rgba(167,139,250,0.08) 0%, transparent 40%), radial-gradient(ellipse at 50% 80%, rgba(124,58,237,0.06) 0%, transparent 50%)",
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
          {["Features", "Platform", "Community", "Pricing"].map((item) => (
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
                  v.to === "/16"
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
                <span className="text-[10px] text-[#71717a] font-medium">
                  {cell.label}
                </span>
              </motion.div>
            ))}
          </div>
        </div>

        {SATELLITE_NODES.map((node, i) => (
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
            <span className="text-[10px] text-[#a78bfa] font-medium">
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
              stroke="rgba(255,255,255,0.06)"
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
          className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-[#7c3aed]/30 bg-[#7c3aed]/10 mb-8"
          initial={{ opacity: 0, y: 10 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ ...ease, delay: 0.05 }}
        >
          <span className="text-sm text-[#a78bfa] font-medium" style={font.body}>
            Open Source &middot; Self-Hosted &middot; MIT License
          </span>
        </motion.div>

        <motion.h1
          className="text-5xl md:text-7xl font-extrabold text-[#fafafa] leading-[1.1] tracking-tight"
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
          transition={{ ...ease, delay: 0.25 }}
        >
          Deploy any application, database, or service on your own servers.
          Free alternative to Heroku, Vercel, and Netlify &mdash; community-driven,
          no vendor lock-in.
        </motion.p>

        <motion.div
          className="mt-8 max-w-lg mx-auto"
          initial={{ opacity: 0, y: 10 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ ...ease, delay: 0.35 }}
        >
          <button
            onClick={handleCopy}
            className="w-full flex items-center justify-between px-5 py-3 rounded-xl border border-white/[0.08] bg-[#18181b] hover:border-[#7c3aed]/40 transition-colors group"
          >
            <span className="text-sm text-[#a78bfa] truncate" style={font.mono}>
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
          className="mt-6 flex items-center justify-center gap-3 flex-wrap"
          initial={{ opacity: 0, y: 10 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ ...ease, delay: 0.45 }}
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
            className="px-6 py-2.5 text-sm font-semibold rounded-lg border border-white/[0.12] text-[#fafafa] hover:border-white/[0.2] transition-colors inline-flex items-center gap-2"
            style={font.display}
          >
            <Star size={16} /> Star on GitHub
            <span className="text-white/70 text-xs ml-1">2.4k</span>
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
    <section ref={ref} className="relative z-10 py-24 px-5 border-b border-white/[0.08]">
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
            className="mt-2 text-xl font-semibold text-[#a1a1aa]"
            style={font.display}
          >
            &mdash; self-hosted, open source, no limits.
          </p>
          <p
            className="mt-4 text-base text-[#71717a] max-w-xl leading-relaxed"
            style={font.body}
          >
            Otterdeploy gives you a complete self-hosted PaaS with declarative
            configs, git-driven deploys, real-time monitoring, automatic SSL,
            database backups, and multi-tenant RBAC &mdash; all from a single command.
          </p>
        </motion.div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Animated Terminal Section
// ---------------------------------------------------------------------------

function AnimatedTerminalSection() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-60px" });

  return (
    <section
      ref={ref}
      className="relative z-10 py-28 px-5"
      style={{
        background:
          "radial-gradient(ellipse at 50% 0%, rgba(124,58,237,0.2) 0%, transparent 60%), radial-gradient(ellipse at 30% 50%, rgba(59,130,246,0.1) 0%, transparent 50%), #09090b",
      }}
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
                    type: "tween",
                    ease: "easeOut",
                    delay: 0.08 * i,
                    duration: 0.4,
                  }}
                >
                  <TerminalLine line={line} />
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
// Feature Sections with sticky tab bar (smooth-scroll navigation)
// ---------------------------------------------------------------------------

function FeatureSection({
  tab,
  reverse,
}: {
  tab: (typeof FEATURE_TABS)[number];
  reverse?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });

  return (
    <div
      id={`feature-${tab.key}`}
      ref={ref}
      className="scroll-mt-28 py-20 px-5 border-b border-white/[0.06]"
    >
      <motion.div
        className={`max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-12 items-center ${
          reverse ? "lg:direction-rtl" : ""
        }`}
        initial={{ opacity: 0, y: 24 }}
        animate={inView ? { opacity: 1, y: 0 } : {}}
        transition={ease}
        style={{ direction: "ltr" }}
      >
        {/* Text side */}
        <div className={reverse ? "lg:order-2" : ""}>
          <div className="inline-flex items-center gap-2 mb-4 text-[#7c3aed]">
            {tab.icon}
            <span
              className="text-xs uppercase tracking-wider font-medium text-[#a78bfa]"
              style={font.mono}
            >
              {tab.label}
            </span>
          </div>
          <h3
            className="text-2xl md:text-3xl font-bold text-[#fafafa] mb-4"
            style={font.display}
          >
            {tab.heading}
          </h3>
          <p
            className="text-base text-[#a1a1aa] leading-relaxed mb-8"
            style={font.body}
          >
            {tab.desc}
          </p>
          <ul className="flex flex-col gap-3.5">
            {tab.bullets.map((b) => (
              <li key={b} className="flex items-start gap-3">
                <span className="mt-0.5 shrink-0">
                  <Check size={16} className="text-[#4ade80]" />
                </span>
                <span
                  className="text-sm text-[#a1a1aa] leading-relaxed"
                  style={font.body}
                >
                  {b}
                </span>
              </li>
            ))}
          </ul>
        </div>

        {/* Terminal visual */}
        <div className={reverse ? "lg:order-1" : ""}>
          <TerminalWindow title={tab.terminal.title}>
            <div className="text-xs leading-relaxed whitespace-pre min-h-[220px]">
              {tab.terminal.lines.map((line, i) => (
                <motion.div
                  key={`${tab.key}-${i}`}
                  initial={{ opacity: 0 }}
                  animate={inView ? { opacity: 1 } : {}}
                  transition={{
                    type: "tween",
                    ease: "easeOut",
                    delay: 0.2 + 0.05 * i,
                    duration: 0.3,
                  }}
                >
                  <TerminalLine line={line} />
                </motion.div>
              ))}
            </div>
          </TerminalWindow>
        </div>
      </motion.div>
    </div>
  );
}

function FeatureTabs() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-60px" });
  const [activeKey, setActiveKey] = useState(FEATURE_TABS[0].key);

  const scrollTo = (key: string) => {
    setActiveKey(key);
    const el = document.getElementById(`feature-${key}`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  // Update active tab based on scroll position
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const key = entry.target.id.replace("feature-", "");
            setActiveKey(key);
          }
        }
      },
      { rootMargin: "-40% 0px -50% 0px" }
    );

    for (const tab of FEATURE_TABS) {
      const el = document.getElementById(`feature-${tab.key}`);
      if (el) observer.observe(el);
    }

    return () => observer.disconnect();
  }, []);

  return (
    <section
      id="features"
      ref={ref}
      className="relative z-10"
      style={{
        background:
          "radial-gradient(ellipse at 50% 0%, rgba(124,58,237,0.1) 0%, transparent 50%), radial-gradient(ellipse at 80% 100%, rgba(59,130,246,0.06) 0%, transparent 40%), #0c0c0f",
      }}
    >
      {/* Header */}
      <div className="pt-28 pb-20 px-5">
        <motion.div
          className="text-center"
          initial={{ opacity: 0, y: 15 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={ease}
        >
          <h2
            className="text-4xl md:text-5xl font-bold text-[#fafafa] tracking-tight"
            style={font.display}
          >
            Everything you need in one tool
          </h2>
          <p
            className="mt-4 text-base text-[#71717a] max-w-2xl mx-auto leading-relaxed"
            style={font.body}
          >
            Otterdeploy unifies your entire deployment workflow into
            a single, powerful command-line interface.
          </p>
        </motion.div>
      </div>

      {/* Sticky tab bar */}
      <div className="sticky top-12 z-40 bg-[#0c0c0f]/90 backdrop-blur-lg border-t border-b border-white/[0.08] overflow-x-auto">
        <div className="max-w-6xl mx-auto flex">
          {FEATURE_TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => scrollTo(tab.key)}
              className={`flex items-center justify-center gap-2.5 px-6 py-4 text-sm whitespace-nowrap border-b-2 transition-colors flex-1 min-w-0 ${
                activeKey === tab.key
                  ? "border-[#7c3aed] text-[#fafafa] bg-white/[0.02]"
                  : "border-transparent text-[#71717a] hover:text-[#a1a1aa] hover:bg-white/[0.02]"
              }`}
              style={{ ...font.mono, fontWeight: 500 }}
            >
              {tab.icon}
              <span className="hidden sm:inline">{tab.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* All feature sections stacked */}
      {FEATURE_TABS.map((tab, i) => (
        <FeatureSection key={tab.key} tab={tab} reverse={i % 2 === 1} />
      ))}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Contributor Showcase (kept from original /16)
// ---------------------------------------------------------------------------

function ContributorShowcase() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });

  return (
    <section id="community" ref={ref} className="relative z-10 py-24 px-5 border-t border-white/[0.08]">
      <div className="max-w-5xl mx-auto">
        <motion.div
          className="text-center mb-12"
          initial={{ opacity: 0, y: 15 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={ease}
        >
          <h2 className="text-4xl font-bold text-[#fafafa] tracking-tight" style={font.display}>
            Community driven
          </h2>
          <p className="mt-3 text-base text-[#71717a]" style={font.body}>
            42 contributors and growing. The community shapes the roadmap.
          </p>
        </motion.div>

        {/* Avatar grid */}
        <motion.div
          className="flex flex-wrap justify-center gap-3 mb-8"
          initial={{ opacity: 0 }}
          animate={inView ? { opacity: 1 } : {}}
          transition={{ ...ease, delay: 0.1 }}
        >
          {CONTRIBUTOR_AVATARS.map((c, i) => (
            <motion.div
              key={i}
              className="w-12 h-12 rounded-full border border-white/[0.08] flex items-center justify-center hover:border-[#7c3aed]/40 transition-colors"
              style={{ background: `${c.color}15` }}
              initial={{ opacity: 0, scale: 0.5 }}
              animate={inView ? { opacity: 1, scale: 1 } : {}}
              transition={{ ...ease, delay: 0.1 + 0.03 * i }}
            >
              <span
                className="text-xs font-medium"
                style={{ color: c.color, ...font.mono }}
              >
                {c.initials}
              </span>
            </motion.div>
          ))}
        </motion.div>

        <motion.div
          className="text-center mb-4"
          initial={{ opacity: 0 }}
          animate={inView ? { opacity: 1 } : {}}
          transition={{ ...ease, delay: 0.3 }}
        >
          <a
            href="#"
            className="text-sm text-[#a78bfa] hover:text-[#7c3aed] transition-colors inline-flex items-center gap-1"
            style={{ ...font.body, fontWeight: 500 }}
          >
            Become a contributor <ArrowRight size={14} />
          </a>
        </motion.div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Testimonials
// ---------------------------------------------------------------------------

function TestimonialsSection() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });

  return (
    <section
      ref={ref}
      className="relative z-10 py-24 px-5 border-t border-white/[0.08]"
      style={{
        background:
          "radial-gradient(ellipse at 30% 50%, rgba(124,58,237,0.08) 0%, transparent 50%), #09090b",
      }}
    >
      <div className="max-w-5xl mx-auto">
        <motion.h2
          className="text-3xl font-bold text-[#fafafa] tracking-tight text-center mb-12"
          style={font.display}
          initial={{ opacity: 0, y: 15 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={ease}
        >
          Loved by the community
        </motion.h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {TESTIMONIALS.map((t, i) => (
            <motion.div
              key={i}
              className="rounded-xl border border-white/[0.08] bg-[#18181b] p-6 hover:border-[#7c3aed]/20 transition-colors flex flex-col"
              initial={{ opacity: 0, y: 15 }}
              animate={inView ? { opacity: 1, y: 0 } : {}}
              transition={{ ...ease, delay: 0.08 * i }}
            >
              <Quote size={20} className="text-[#7c3aed]/40 mb-3" />
              <p
                className="text-sm text-[#a1a1aa] leading-relaxed flex-1"
                style={font.body}
              >
                {t.quote}
              </p>
              <div className="mt-4 pt-4 border-t border-white/[0.06]">
                <div className="text-sm font-semibold text-[#fafafa]" style={font.display}>
                  {t.author}
                </div>
                <div className="text-xs text-[#71717a]" style={font.body}>
                  {t.role}
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
// Two Columns — Why Self-Host + Open Source
// ---------------------------------------------------------------------------

function TwoColumns() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });

  const selfHostBullets = [
    "Data sovereignty \u2014 your servers, your data, your rules",
    "No surprise bills or usage-based pricing",
    "Compliance-ready for regulated industries (GDPR, HIPAA, SOC 2)",
    "Full customization and extensibility via plugins",
    "Unlimited resources \u2014 scale to your hardware, not a pricing tier",
    "Run on any cloud, VPS, or bare metal server",
  ];

  const openSourceBullets = [
    "MIT licensed \u2014 use it anywhere, for anything",
    "Transparent development on GitHub",
    "Community-driven roadmap and priorities",
    "42+ contributors and growing fast",
    "Regular releases with full changelogs",
    "No vendor lock-in, ever",
  ];

  return (
    <section
      ref={ref}
      className="relative z-10 py-24 px-5 border-t border-white/[0.08]"
      style={{ background: "#111113" }}
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
      className="relative z-10 py-24 px-5 border-t border-white/[0.08]"
    >
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
            Simple, transparent pricing
          </h2>
          <p className="mt-2 text-base text-[#71717a]" style={font.body}>
            The core platform is and always will be free. Pay only for the support your team needs.
          </p>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Community = Free */}
          <motion.div
            className="rounded-xl border-2 border-[#7c3aed] bg-[#18181b] p-8"
            initial={{ opacity: 0, y: 15 }}
            animate={inView ? { opacity: 1, y: 0 } : {}}
            transition={{ ...ease, delay: 0.05 }}
          >
            <span
              className="text-xs text-[#a78bfa] uppercase tracking-wider font-medium"
              style={font.mono}
            >
              Community
            </span>
            <div className="text-4xl font-bold text-[#fafafa] mt-2" style={font.display}>
              Free
            </div>
            <p className="text-sm text-[#a1a1aa] mt-2 leading-relaxed" style={font.body}>
              All core features, unlimited deployments, unlimited services, community support.
            </p>
            <div className="mt-5 flex flex-col gap-2.5">
              {[
                "Unlimited deployments",
                "All service types",
                "Automatic SSL",
                "Database backups",
                "Full CLI & API access",
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

          {/* Pro */}
          <motion.div
            className="rounded-xl border border-white/[0.08] bg-[#18181b] p-8 hover:border-[#7c3aed]/30 transition-colors"
            initial={{ opacity: 0, y: 15 }}
            animate={inView ? { opacity: 1, y: 0 } : {}}
            transition={{ ...ease, delay: 0.1 }}
          >
            <span
              className="text-xs text-[#71717a] uppercase tracking-wider"
              style={font.mono}
            >
              Pro
            </span>
            <div className="mt-2 flex items-baseline gap-1">
              <span className="text-4xl font-bold text-[#fafafa]" style={font.display}>
                $29
              </span>
              <span className="text-sm text-[#71717a]">/mo</span>
            </div>
            <p className="text-sm text-[#a1a1aa] mt-2 leading-relaxed" style={font.body}>
              Priority support, advanced RBAC, SSO, and audit logs.
            </p>
            <div className="mt-5 flex flex-col gap-2.5">
              {[
                "Everything in Community",
                "Priority support",
                "Advanced RBAC",
                "SSO integration",
                "Audit logs",
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
            className="rounded-xl border border-white/[0.08] bg-[#18181b] p-8 hover:border-[#7c3aed]/30 transition-colors"
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
              Dedicated support, SLA, custom integrations, and on-premises deployment.
            </p>
            <div className="mt-5 flex flex-col gap-2.5">
              {[
                "Everything in Pro",
                "Dedicated support",
                "Custom SLA",
                "On-prem deployment",
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
      className="relative z-10 py-28 px-5 border-t border-white/[0.08]"
      style={{
        background:
          "radial-gradient(ellipse at 50% 20%, rgba(124,58,237,0.2) 0%, transparent 60%), radial-gradient(ellipse at 30% 80%, rgba(167,139,250,0.08) 0%, transparent 50%), #09090b",
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
          Start deploying on your own servers
        </motion.h2>

        <motion.p
          className="mt-4 text-base text-[#a1a1aa]"
          style={font.body}
          initial={{ opacity: 0, y: 10 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ ...ease, delay: 0.1 }}
        >
          One command. Your servers. Your rules. Free and open source forever.
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
            <span className="text-sm text-[#a78bfa] truncate" style={font.mono}>
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
          <div className="flex items-center gap-3 flex-wrap justify-center">
            <a
              href="#"
              className="px-6 py-2.5 rounded-lg bg-[#7c3aed] text-white text-sm font-semibold hover:bg-[#6d28d9] transition-colors inline-flex items-center gap-2"
              style={font.display}
            >
              Get Started <ArrowRight size={16} />
            </a>
            <a
              href="#"
              className="px-6 py-2.5 rounded-lg border border-white/[0.12] text-[#fafafa] text-sm font-semibold hover:border-white/[0.2] transition-colors inline-flex items-center gap-2"
              style={font.display}
            >
              <Star size={16} /> Star on GitHub
              <span className="text-white/70 text-xs ml-1">2.4k</span>
            </a>
          </div>

          <span className="text-xs text-[#71717a]" style={font.mono}>
            Free &middot; Open Source &middot; Self-Hosted &middot; MIT Licensed
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
    <footer className="relative z-10 px-5 py-12 border-t border-white/[0.08]">
      <div className="max-w-7xl mx-auto">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-8">
          {/* Brand */}
          <div>
            <div className="flex items-center gap-1 mb-3">
              <span className="text-[#fafafa] font-bold tracking-tight" style={font.display}>
                otterdeploy
              </span>
              <span className="w-1.5 h-1.5 rounded-full bg-[#7c3aed] inline-block mb-2" />
            </div>
            <p className="text-sm text-[#71717a] leading-relaxed" style={font.body}>
              Self-hosted PaaS for teams that ship. Free and open source.
            </p>
            <div className="flex items-center gap-3 mt-4">
              <a href="#" className="text-[#71717a] hover:text-[#a1a1aa] transition-colors">
                <Github size={16} />
              </a>
              <a href="#" className="text-[#71717a] hover:text-[#a1a1aa] transition-colors">
                <MessageCircle size={16} />
              </a>
            </div>
            <div className="flex items-center gap-1 mt-4">
              {VARIANT_LINKS.map((v) => (
                <Link
                  key={v.to}
                  to={v.to}
                  className={`w-6 h-6 flex items-center justify-center text-xs rounded transition-colors ${
                    v.to === "/16"
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

          {/* Contributors */}
          <div>
            <h5
              className="text-xs text-[#71717a] uppercase tracking-wider mb-3"
              style={font.mono}
            >
              Contributors
            </h5>
            <div className="flex flex-wrap gap-1 mb-3">
              {CONTRIBUTOR_AVATARS.slice(0, 6).map((c, i) => (
                <div
                  key={i}
                  className="w-6 h-6 rounded-full border border-white/[0.08] flex items-center justify-center"
                  style={{ background: `${c.color}15` }}
                >
                  <span
                    className="text-[7px] font-medium"
                    style={{ color: c.color, ...font.mono }}
                  >
                    {c.initials}
                  </span>
                </div>
              ))}
            </div>
            <p className="text-sm text-[#a1a1aa]" style={font.body}>
              42 contributors
            </p>
            <a
              href="#"
              className="text-xs text-[#a78bfa] hover:text-[#7c3aed] transition-colors mt-1 inline-block"
              style={font.body}
            >
              View all contributors
            </a>
          </div>
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
    <div className="bg-[#09090b] text-[#fafafa] min-h-screen relative" style={font.body}>
      <DotGridBackground />
      <Nav />
      <Hero />
      <EverythingSection />
      <AnimatedTerminalSection />
      <FeatureTabs />
      <ContributorShowcase />
      <TestimonialsSection />
      <TwoColumns />
      <PricingGrid />
      <CTA />
      <Footer />
    </div>
  );
}
