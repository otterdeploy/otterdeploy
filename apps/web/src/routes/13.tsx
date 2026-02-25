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
  Users,
  Lock,
  Eye,
  KeyRound,
  Building2,
  FileSearch,
  BadgeCheck,
  UserCog,
  Network,
  ShieldCheck,
  Calendar,
  Star,
  Heart,
  MessageCircle,
  ChevronRight,
} from "lucide-react";

export const Route = createFileRoute("/13")({
  component: RouteComponent,
});

// ---------------------------------------------------------------------------
// Font Loader
// ---------------------------------------------------------------------------

function useFonts() {
  useEffect(() => {
    const id = "teams-enterprise-fonts";
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

const TEAM_GRID_LABELS = [
  { label: ".ADMIN", x: -120, y: -50 },
  { label: ".DEPLOY", x: 200, y: -40 },
  { label: ".VIEWER", x: 220, y: 90 },
  { label: ".AUDIT", x: -130, y: 100 },
  { label: ".SSO", x: 50, y: 190 },
];

const GRID_CELLS = [
  { label: "org", r: 0, c: 0 },
  { label: "team", r: 0, c: 1 },
  { label: "user", r: 0, c: 2 },
  { label: "role", r: 1, c: 0 },
  { label: "policy", r: 1, c: 1 },
  { label: "scope", r: 1, c: 2 },
  { label: "audit", r: 2, c: 0 },
  { label: "log", r: 2, c: 1 },
  { label: "token", r: 2, c: 2 },
];

const STATS = [
  { value: "500+", label: "teams" },
  { value: "99.9%", label: "uptime SLA" },
  { value: "0", label: "policy violations" },
  { value: "100%", label: "audit coverage" },
];

const FEATURE_TABS = {
  teams: {
    label: "TEAMS",
    heading: "Organize by teams",
    bullets: [
      "Create unlimited organizations and teams",
      "Invite members with granular permissions",
      "Isolate environments per team",
      "Shared resource pools with quotas",
    ],
    code: `$ otter team create --org acme-corp --name platform
\u2713 Team "platform" created in acme-corp

$ otter team add-member --team platform --user sarah@acme.com --role deploy
\u2713 sarah@acme.com added as deploy to platform

$ otter team list --org acme-corp
  NAME         MEMBERS  ENVIRONMENTS
  platform     8        prod, staging
  frontend     5        prod, staging, preview
  data         3        prod, analytics`,
  },
  rbac: {
    label: "RBAC",
    heading: "Fine-grained access control",
    bullets: [
      "Predefined roles: Admin, Deploy, Read",
      "Custom role definitions via YAML",
      "Per-project permission overrides",
      "API key scoping per role",
    ],
    code: `# roles/deploy.yml
name: deploy
description: Can deploy and view services
permissions:
  - service:deploy
  - service:read
  - secret:read
  - log:read
deny:
  - secret:write
  - team:manage
  - billing:*

# Applied to team:
$ otter rbac assign --user dev@acme.com --role deploy
\u2713 Role "deploy" assigned`,
  },
  audit: {
    label: "AUDIT",
    heading: "Complete audit trails",
    bullets: [
      "Every action logged with user context",
      "Immutable append-only audit log",
      "Export to SIEM or compliance tools",
      "Retention policies and archiving",
    ],
    code: `$ otter audit log --last 24h --format table

TIMESTAMP            USER              ACTION
2026-02-22 09:14:02  sarah@acme.com    service.deploy (prod/api)
2026-02-22 09:12:41  sarah@acme.com    secret.read (DATABASE_URL)
2026-02-22 08:55:19  admin@acme.com    role.assign (sarah -> deploy)
2026-02-22 08:30:07  admin@acme.com    team.create (platform)
2026-02-22 08:15:33  system            backup.complete (daily)

Total: 847 events | Exported: 0 violations`,
  },
  sso: {
    label: "SSO",
    heading: "Enterprise single sign-on",
    bullets: [
      "SAML 2.0 and OIDC support",
      "Auto-provision users on first login",
      "Map IdP groups to Otter roles",
      "Enforce SSO-only authentication",
    ],
    code: `# sso/okta.yml
provider: okta
protocol: saml
entity_id: https://otter.acme.com
acs_url: https://otter.acme.com/auth/saml/callback
group_mapping:
  okta-admins: admin
  okta-devs: deploy
  okta-viewers: read
enforce: true
auto_provision: true

$ otter sso test --provider okta
\u2713 SAML assertion valid
\u2713 Group mapping configured
\u2713 SSO enforced for all users`,
  },
};

type TabKey = keyof typeof FEATURE_TABS;

const TESTIMONIALS = [
  {
    name: "Sarah Chen",
    role: "VP of Engineering, Acme Corp",
    text: "We moved 12 teams onto Otterdeploy and finally have consistent governance across all our services. The RBAC system is exactly what we needed.",
    initials: "SC",
  },
  {
    name: "Marcus Rivera",
    role: "Platform Lead, Nexus Labs",
    text: "Audit trails saved us during our SOC 2 audit. Every deployment, every secret access -- all logged and exportable. Our compliance team loves it.",
    initials: "MR",
  },
  {
    name: "Emily Nakamura",
    role: "CTO, Cloudbridge IO",
    text: "SSO integration took 15 minutes. Our team went from shared credentials to proper identity management overnight. Self-hosted means we own the data.",
    initials: "EN",
  },
];

const INSTALL_CMD = "curl -fsSL https://get.otterdeploy.com | sh";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const font = {
  display: { fontFamily: "'Plus Jakarta Sans', sans-serif" },
  body: { fontFamily: "'Plus Jakarta Sans', sans-serif" },
  mono: { fontFamily: "'JetBrains Mono', monospace" },
};

const ease = { type: "tween" as const, ease: "easeOut" as const, duration: 0.4 };

const dotGrid = {
  backgroundImage: "radial-gradient(rgba(255,255,255,0.03) 1px, transparent 1px)",
  backgroundSize: "24px 24px",
};

const aurora = `radial-gradient(ellipse at 50% 0%, rgba(124,58,237,0.15) 0%, transparent 50%),
  radial-gradient(ellipse at 80% 20%, rgba(59,130,246,0.08) 0%, transparent 40%),
  #09090b`;

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
// Navigation
// ---------------------------------------------------------------------------

function Nav() {
  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-[#09090b]/90 backdrop-blur-xl border-b border-white/[0.08]">
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
          {["Features", "Pricing", "Docs", "Enterprise"].map((item) => (
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
                  v.to === "/13"
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
            Start for free
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
                <span className="text-[10px] text-[#a1a1aa] font-medium">
                  {cell.label}
                </span>
              </motion.div>
            ))}
          </div>
        </div>

        {TEAM_GRID_LABELS.map((node, i) => (
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
          {TEAM_GRID_LABELS.map((node, i) => (
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

  const handleCopy = () => {
    navigator.clipboard.writeText(INSTALL_CMD);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <section
      ref={ref}
      className="pt-28 pb-16 px-5"
      style={{ background: aurora, ...dotGrid }}
    >
      <div className="max-w-5xl mx-auto text-center">
        <motion.div
          className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-white/[0.08] bg-[#18181b] mb-8"
          initial={{ opacity: 0, y: 10 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ ...ease, delay: 0.05 }}
        >
          <Shield size={16} className="text-[#a78bfa]" />
          <span className="text-sm text-[#a1a1aa] font-medium" style={font.body}>
            Multi-Tenant &middot; RBAC &middot; Audit Trails
          </span>
        </motion.div>

        <motion.h1
          className="text-5xl md:text-7xl font-extrabold text-[#fafafa] leading-[1.1] tracking-tight"
          style={font.display}
          initial={{ opacity: 0, y: 20 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ ...ease, delay: 0.1 }}
        >
          Infrastructure Your
          <br />
          Team Can <span className="text-[#7c3aed]">Trust</span>
        </motion.h1>

        <motion.p
          className="mt-6 text-lg text-[#a1a1aa] max-w-2xl mx-auto leading-relaxed"
          style={{ ...font.body, fontWeight: 400 }}
          initial={{ opacity: 0, y: 15 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ ...ease, delay: 0.25 }}
        >
          Multi-tenant platform with role-based access, audit trails, and compliance.
          Self-hosted for complete data sovereignty.
        </motion.p>

        {/* Install command */}
        <motion.div
          className="mt-8 flex justify-center"
          initial={{ opacity: 0, y: 10 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ ...ease, delay: 0.35 }}
        >
          <button
            onClick={handleCopy}
            className="flex items-center gap-3 px-5 py-3 rounded-xl border border-white/[0.08] bg-[#111111] hover:border-[#7c3aed]/40 transition-colors group"
          >
            <span className="text-sm text-[#a78bfa]" style={font.mono}>
              $ {INSTALL_CMD}
            </span>
            {copied ? (
              <Check size={16} className="text-[#4ade80] shrink-0" />
            ) : (
              <Copy size={16} className="text-[#71717a] group-hover:text-[#a1a1aa] transition-colors shrink-0" />
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
            Start for free <ArrowRight size={16} />
          </a>
          <a
            href="#pricing"
            className="px-6 py-2.5 text-sm font-semibold rounded-lg border border-white/[0.08] text-[#fafafa] hover:border-white/[0.16] transition-colors inline-flex items-center gap-2"
            style={font.display}
          >
            <Calendar size={16} /> Schedule a demo
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
    <section ref={ref} className="border-t border-b border-white/[0.08] bg-[#09090b]">
      <div className="max-w-5xl mx-auto grid grid-cols-2 md:grid-cols-4">
        {STATS.map((stat, i) => (
          <motion.div
            key={stat.label}
            className={`py-10 px-6 text-center ${
              i < STATS.length - 1
                ? "md:border-r md:border-white/[0.08]"
                : ""
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
// Bento Grid -- Team Features
// ---------------------------------------------------------------------------

function BentoGrid() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });

  return (
    <section
      id="features"
      ref={ref}
      className="py-24 px-5 bg-[#09090b] border-t border-white/[0.08]"
      style={dotGrid}
    >
      <div className="max-w-5xl mx-auto">
        <motion.div
          className="mb-10"
          initial={{ opacity: 0, y: 15 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={ease}
        >
          <span className="text-xs text-[#7c3aed] uppercase tracking-wider mb-3 block" style={font.mono}>
            Team Features
          </span>
          <h2 className="text-4xl font-bold text-[#fafafa] tracking-tight" style={font.display}>
            Built for teams that ship
          </h2>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {/* RBAC -- col-span-2 */}
          <motion.div
            className="md:col-span-2 rounded-xl border border-white/[0.08] bg-[#18181b] p-6 hover:border-[#7c3aed]/30 transition-colors"
            initial={{ opacity: 0, scale: 0.97 }}
            animate={inView ? { opacity: 1, scale: 1 } : {}}
            transition={{ ...ease, delay: 0.05 }}
          >
            <div className="flex items-center gap-2 mb-2">
              <ShieldCheck size={18} className="text-[#7c3aed]" />
              <h3 className="text-base font-semibold text-[#fafafa]" style={font.display}>
                Role-Based Access Control
              </h3>
              <span
                className="ml-auto px-2 py-0.5 rounded text-[10px] font-medium bg-[#7c3aed]/15 text-[#a78bfa]"
                style={font.mono}
              >
                RBAC
              </span>
            </div>
            <p className="text-sm text-[#a1a1aa] mb-4 leading-relaxed" style={font.body}>
              Define who can do what with granular role hierarchies. Admin, Deploy, and Read roles
              out of the box -- or create custom roles for your workflow.
            </p>
            <div className="rounded-lg border border-white/[0.08] bg-[#09090b] p-4">
              <div className="flex flex-col gap-2">
                {[
                  { role: "Admin", perms: ["*"], color: "#7c3aed" },
                  { role: "Deploy", perms: ["deploy", "read", "logs"], color: "#4ade80" },
                  { role: "Read", perms: ["read", "logs"], color: "#22d3ee" },
                ].map((r) => (
                  <div key={r.role} className="flex items-center gap-3">
                    <span
                      className="text-xs font-medium w-16"
                      style={{ ...font.mono, color: r.color }}
                    >
                      {r.role}
                    </span>
                    <ChevronRight size={12} className="text-[#71717a]" />
                    <div className="flex gap-1.5">
                      {r.perms.map((p) => (
                        <span
                          key={p}
                          className="px-2 py-0.5 rounded text-[10px] bg-white/[0.05] text-[#a1a1aa] border border-white/[0.06]"
                          style={font.mono}
                        >
                          {p}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>

          {/* Multi-tenancy -- 1x1 */}
          <motion.div
            className="rounded-xl border border-white/[0.08] bg-[#18181b] p-6 hover:border-[#7c3aed]/30 transition-colors"
            initial={{ opacity: 0, scale: 0.97 }}
            animate={inView ? { opacity: 1, scale: 1 } : {}}
            transition={{ ...ease, delay: 0.1 }}
          >
            <div className="flex items-center gap-2 mb-2">
              <Building2 size={18} className="text-[#7c3aed]" />
              <h3 className="text-base font-semibold text-[#fafafa]" style={font.display}>
                Multi-Tenancy
              </h3>
            </div>
            <p className="text-sm text-[#a1a1aa] mb-4 leading-relaxed" style={font.body}>
              Isolate organizations, teams, and environments with full resource separation.
            </p>
            <div className="rounded-lg border border-white/[0.08] bg-[#09090b] p-3 text-xs" style={font.mono}>
              <div className="text-[#a78bfa]">Acme Corp</div>
              <div className="ml-3 mt-1 text-[#a1a1aa] border-l border-white/[0.08] pl-3">
                <div className="text-[#4ade80]">Platform</div>
                <div className="text-[#22d3ee] mt-0.5">Frontend</div>
                <div className="text-[#a1a1aa] mt-0.5">Data</div>
              </div>
            </div>
          </motion.div>

          {/* Audit Trails -- 1x1 */}
          <motion.div
            className="rounded-xl border border-white/[0.08] bg-[#18181b] p-6 hover:border-[#7c3aed]/30 transition-colors"
            initial={{ opacity: 0, scale: 0.97 }}
            animate={inView ? { opacity: 1, scale: 1 } : {}}
            transition={{ ...ease, delay: 0.15 }}
          >
            <div className="flex items-center gap-2 mb-2">
              <FileSearch size={18} className="text-[#7c3aed]" />
              <h3 className="text-base font-semibold text-[#fafafa]" style={font.display}>
                Audit Trails
              </h3>
            </div>
            <p className="text-sm text-[#a1a1aa] mb-4 leading-relaxed" style={font.body}>
              Immutable, append-only log of every action taken on your platform.
            </p>
            <div className="rounded-lg border border-white/[0.08] bg-[#09090b] p-3 flex flex-col gap-1.5">
              {[
                { time: "09:14", action: "deploy", user: "sarah" },
                { time: "09:12", action: "secret.read", user: "sarah" },
                { time: "08:55", action: "role.assign", user: "admin" },
              ].map((e, i) => (
                <div key={i} className="flex items-center gap-2 text-[10px]" style={font.mono}>
                  <span className="text-[#71717a]">{e.time}</span>
                  <span className="text-[#4ade80]">{e.action}</span>
                  <span className="text-[#a1a1aa] ml-auto">{e.user}</span>
                </div>
              ))}
            </div>
          </motion.div>

          {/* SSO -- col-span-2 */}
          <motion.div
            className="md:col-span-2 rounded-xl border border-white/[0.08] bg-[#18181b] p-6 hover:border-[#7c3aed]/30 transition-colors"
            initial={{ opacity: 0, scale: 0.97 }}
            animate={inView ? { opacity: 1, scale: 1 } : {}}
            transition={{ ...ease, delay: 0.2 }}
          >
            <div className="flex items-center gap-2 mb-2">
              <KeyRound size={18} className="text-[#7c3aed]" />
              <h3 className="text-base font-semibold text-[#fafafa]" style={font.display}>
                Single Sign-On
              </h3>
            </div>
            <p className="text-sm text-[#a1a1aa] mb-4 leading-relaxed" style={font.body}>
              Connect your identity provider for seamless, secure authentication across your organization.
            </p>
            <div className="flex flex-wrap items-center gap-3 mb-4">
              {["Okta", "Auth0", "Azure AD", "Google"].map((provider) => (
                <span
                  key={provider}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium bg-[#09090b] text-[#a1a1aa] border border-white/[0.08] hover:border-[#7c3aed]/30 transition-colors"
                  style={font.mono}
                >
                  {provider}
                </span>
              ))}
            </div>
            <TerminalWindow title="sso-config.sh">
              <div className="text-xs leading-relaxed">
                <div className="text-[#fafafa]">$ otter sso configure --provider okta</div>
                <div className="text-[#4ade80] mt-1">{"\u2713"} SAML 2.0 configured</div>
                <div className="text-[#4ade80]">{"\u2713"} Group mapping: 3 roles synced</div>
                <div className="text-[#4ade80]">{"\u2713"} SSO enforcement enabled</div>
              </div>
            </TerminalWindow>
          </motion.div>

          {/* Compliance -- 1x1 */}
          <motion.div
            className="rounded-xl border border-white/[0.08] bg-[#18181b] p-6 hover:border-[#7c3aed]/30 transition-colors"
            initial={{ opacity: 0, scale: 0.97 }}
            animate={inView ? { opacity: 1, scale: 1 } : {}}
            transition={{ ...ease, delay: 0.25 }}
          >
            <div className="flex items-center gap-2 mb-2">
              <BadgeCheck size={18} className="text-[#7c3aed]" />
              <h3 className="text-base font-semibold text-[#fafafa]" style={font.display}>
                Compliance
              </h3>
            </div>
            <p className="text-sm text-[#a1a1aa] mb-4 leading-relaxed" style={font.body}>
              Meet industry standards with built-in compliance tooling.
            </p>
            <div className="flex flex-wrap gap-2">
              {["SOC 2", "GDPR", "HIPAA", "ISO 27001"].map((badge) => (
                <span
                  key={badge}
                  className="px-3 py-1 rounded-md text-xs font-medium bg-[#7c3aed]/10 text-[#a78bfa] border border-[#7c3aed]/20"
                  style={font.mono}
                >
                  {badge}
                </span>
              ))}
            </div>
          </motion.div>

          {/* Secrets Scoping -- 1x1 */}
          <motion.div
            className="rounded-xl border border-white/[0.08] bg-[#18181b] p-6 hover:border-[#7c3aed]/30 transition-colors"
            initial={{ opacity: 0, scale: 0.97 }}
            animate={inView ? { opacity: 1, scale: 1 } : {}}
            transition={{ ...ease, delay: 0.3 }}
          >
            <div className="flex items-center gap-2 mb-2">
              <Lock size={18} className="text-[#7c3aed]" />
              <h3 className="text-base font-semibold text-[#fafafa]" style={font.display}>
                Secrets Scoping
              </h3>
            </div>
            <p className="text-sm text-[#a1a1aa] mb-4 leading-relaxed" style={font.body}>
              Per-team secrets with environment-level isolation. No cross-contamination.
            </p>
            <div className="rounded-lg border border-white/[0.08] bg-[#09090b] p-3 text-[10px]" style={font.mono}>
              <div className="flex items-center gap-2">
                <Network size={10} className="text-[#7c3aed]" />
                <span className="text-[#a78bfa]">platform/prod</span>
              </div>
              <div className="ml-4 mt-1.5 flex flex-col gap-1 text-[#a1a1aa]">
                <span>DATABASE_URL <span className="text-[#71717a]">****</span></span>
                <span>REDIS_URL <span className="text-[#71717a]">****</span></span>
              </div>
              <div className="flex items-center gap-2 mt-2">
                <Network size={10} className="text-[#22d3ee]" />
                <span className="text-[#22d3ee]">frontend/prod</span>
              </div>
              <div className="ml-4 mt-1.5 flex flex-col gap-1 text-[#a1a1aa]">
                <span>API_KEY <span className="text-[#71717a]">****</span></span>
              </div>
            </div>
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
  const [activeTab, setActiveTab] = useState<TabKey>("teams");

  const tabIcons: Record<TabKey, React.ReactNode> = {
    teams: <Users size={16} />,
    rbac: <ShieldCheck size={16} />,
    audit: <Eye size={16} />,
    sso: <KeyRound size={16} />,
  };

  const data = FEATURE_TABS[activeTab];

  return (
    <section
      ref={ref}
      className="py-24 px-5"
      style={{ background: aurora }}
    >
      <div className="max-w-6xl mx-auto">
        <motion.h2
          className="text-3xl md:text-4xl font-bold text-[#fafafa] text-center tracking-tight mb-10"
          style={font.display}
          initial={{ opacity: 0, y: 15 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={ease}
        >
          Everything your team needs
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
              {data.label === FEATURE_TABS[key].label && activeTab === key ? data.label : key}
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
            <h3 className="text-2xl font-bold text-[#fafafa] mb-5" style={font.display}>
              {data.heading}
            </h3>
            <ul className="flex flex-col gap-3">
              {data.bullets.map((b) => (
                <li key={b} className="flex items-center gap-3">
                  <span className="text-[#4ade80]">
                    <Check size={16} />
                  </span>
                  <span className="text-sm text-[#a1a1aa]" style={{ ...font.body, fontWeight: 400 }}>
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
                if (line.includes("\u2713")) {
                  return (
                    <div key={i}>
                      <span className="text-[#4ade80]">{line.slice(0, line.indexOf("\u2713") + 1)}</span>
                      <span className="text-[#fafafa]">{line.slice(line.indexOf("\u2713") + 1)}</span>
                    </div>
                  );
                }
                if (line.includes(":") && !line.startsWith(" ") && !line.startsWith("Total")) {
                  const colonIdx = line.indexOf(":");
                  return (
                    <div key={i}>
                      <span className="text-[#a78bfa]">{line.slice(0, colonIdx + 1)}</span>
                      <span className="text-[#fafafa]">{line.slice(colonIdx + 1)}</span>
                    </div>
                  );
                }
                return <div key={i} className="text-[#a1a1aa]">{line || "\u00a0"}</div>;
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
    <section
      ref={ref}
      className="py-24 px-5 bg-[#09090b] border-t border-white/[0.08]"
      style={dotGrid}
    >
      <div className="max-w-5xl mx-auto">
        <motion.div
          className="text-center mb-12"
          initial={{ opacity: 0, y: 15 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={ease}
        >
          <span className="text-xs text-[#7c3aed] uppercase tracking-wider mb-3 block" style={font.mono}>
            Trusted by Teams
          </span>
          <h2 className="text-3xl md:text-4xl font-bold text-[#fafafa] tracking-tight" style={font.display}>
            Loved by engineering leaders
          </h2>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {TESTIMONIALS.map((t, i) => (
            <motion.div
              key={t.name}
              className="rounded-xl border border-white/[0.08] bg-[#18181b] p-6 hover:border-[#7c3aed]/20 transition-colors"
              initial={{ opacity: 0, y: 15 }}
              animate={inView ? { opacity: 1, y: 0 } : {}}
              transition={{ ...ease, delay: 0.08 * i }}
            >
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-full bg-[#7c3aed]/15 border border-white/[0.08] flex items-center justify-center">
                  <span className="text-xs font-medium text-[#a78bfa]" style={font.mono}>
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
              <p className="text-sm text-[#a1a1aa] leading-relaxed" style={font.body}>
                "{t.text}"
              </p>
              <div className="flex gap-0.5 mt-4">
                {[...Array(5)].map((_, j) => (
                  <Star key={j} size={12} className="text-[#7c3aed] fill-[#7c3aed]" />
                ))}
              </div>
            </motion.div>
          ))}
        </div>
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

  const scaleBullets = [
    "Add teams without adding complexity",
    "Isolated environments per team",
    "Shared infrastructure, separate controls",
    "Onboard new members in seconds",
    "Self-serve deployments with guardrails",
  ];

  const securityBullets = [
    "Zero-trust architecture by default",
    "Encrypted secrets at rest and in transit",
    "Automatic TLS for all services",
    "Vulnerability scanning on every deploy",
    "IP allowlisting and network policies",
  ];

  return (
    <section
      ref={ref}
      className="py-24 px-5 border-t border-white/[0.08]"
      style={{ background: aurora }}
    >
      <div className="max-w-5xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-16">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ ...ease, delay: 0.05 }}
        >
          <div className="flex items-center gap-2 mb-4">
            <UserCog size={20} className="text-[#7c3aed]" />
            <h3 className="text-2xl font-bold text-[#fafafa]" style={font.display}>
              Scale your team
            </h3>
          </div>
          <ul className="flex flex-col gap-3">
            {scaleBullets.map((b) => (
              <li key={b} className="flex items-start gap-3">
                <span className="w-1.5 h-1.5 rounded-full bg-[#7c3aed] mt-2 shrink-0" />
                <span className="text-sm text-[#a1a1aa] leading-relaxed" style={font.body}>
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
          <div className="flex items-center gap-2 mb-4">
            <Shield size={20} className="text-[#7c3aed]" />
            <h3 className="text-2xl font-bold text-[#fafafa]" style={font.display}>
              Enterprise-grade security
            </h3>
          </div>
          <ul className="flex flex-col gap-3">
            {securityBullets.map((b) => (
              <li key={b} className="flex items-start gap-3">
                <span className="w-1.5 h-1.5 rounded-full bg-[#4ade80] mt-2 shrink-0" />
                <span className="text-sm text-[#a1a1aa] leading-relaxed" style={font.body}>
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
// Pricing Grid (Enterprise tier emphasized)
// ---------------------------------------------------------------------------

function PricingGrid() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });

  return (
    <section
      id="pricing"
      ref={ref}
      className="py-24 px-5 bg-[#09090b] border-t border-white/[0.08]"
      style={dotGrid}
    >
      <div className="max-w-5xl mx-auto">
        <motion.div
          className="text-center mb-10"
          initial={{ opacity: 0, y: 15 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={ease}
        >
          <h2 className="text-3xl font-bold text-[#fafafa] tracking-tight" style={font.display}>
            Plans for every team size
          </h2>
          <p className="mt-2 text-base text-[#a1a1aa]" style={font.body}>
            Start free. Scale with confidence. Enterprise when you need it.
          </p>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {/* Free */}
          <motion.div
            className="rounded-xl border border-white/[0.08] bg-[#18181b] p-8 hover:border-white/[0.16] transition-colors"
            initial={{ opacity: 0, y: 15 }}
            animate={inView ? { opacity: 1, y: 0 } : {}}
            transition={{ ...ease, delay: 0.05 }}
          >
            <span className="text-xs text-[#71717a] uppercase tracking-wider" style={font.mono}>
              Starter
            </span>
            <div className="text-4xl font-bold text-[#fafafa] mt-2" style={font.display}>
              Free
            </div>
            <p className="text-sm text-[#a1a1aa] mt-2 leading-relaxed" style={font.body}>
              For individuals and small teams getting started with self-hosted deployments.
            </p>
            <div className="mt-6 flex flex-col gap-2">
              {["Up to 3 team members", "Basic RBAC", "Community support", "Unlimited deploys"].map((f) => (
                <div key={f} className="flex items-center gap-2">
                  <Check size={14} className="text-[#71717a]" />
                  <span className="text-xs text-[#a1a1aa]" style={font.body}>{f}</span>
                </div>
              ))}
            </div>
            <a
              href="#cta"
              className="mt-6 block text-center px-4 py-2 text-sm font-semibold rounded-lg border border-white/[0.08] text-[#fafafa] hover:border-white/[0.16] transition-colors"
              style={font.display}
            >
              Get started
            </a>
          </motion.div>

          {/* Team */}
          <motion.div
            className="rounded-xl border border-white/[0.08] bg-[#18181b] p-8 hover:border-white/[0.16] transition-colors"
            initial={{ opacity: 0, y: 15 }}
            animate={inView ? { opacity: 1, y: 0 } : {}}
            transition={{ ...ease, delay: 0.1 }}
          >
            <span className="text-xs text-[#71717a] uppercase tracking-wider" style={font.mono}>
              Team
            </span>
            <div className="mt-2">
              <span className="text-4xl font-bold text-[#fafafa]" style={font.display}>
                $29
              </span>
              <span className="text-sm text-[#71717a] ml-1">/user/mo</span>
            </div>
            <p className="text-sm text-[#a1a1aa] mt-2 leading-relaxed" style={font.body}>
              For growing teams that need collaboration features and priority support.
            </p>
            <div className="mt-6 flex flex-col gap-2">
              {["Unlimited members", "Full RBAC", "Audit trails", "Priority support"].map((f) => (
                <div key={f} className="flex items-center gap-2">
                  <Check size={14} className="text-[#a78bfa]" />
                  <span className="text-xs text-[#a1a1aa]" style={font.body}>{f}</span>
                </div>
              ))}
            </div>
            <a
              href="#cta"
              className="mt-6 block text-center px-4 py-2 text-sm font-semibold rounded-lg border border-white/[0.08] text-[#fafafa] hover:border-white/[0.16] transition-colors"
              style={font.display}
            >
              Start trial
            </a>
          </motion.div>

          {/* Enterprise -- emphasized */}
          <motion.div
            className="rounded-xl border-2 border-[#7c3aed] bg-[#18181b] p-8 relative"
            initial={{ opacity: 0, y: 15 }}
            animate={inView ? { opacity: 1, y: 0 } : {}}
            transition={{ ...ease, delay: 0.15 }}
          >
            <span
              className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-0.5 rounded-full text-[10px] font-medium bg-[#7c3aed] text-white"
              style={font.mono}
            >
              RECOMMENDED
            </span>
            <span className="text-xs text-[#a78bfa] uppercase tracking-wider font-medium" style={font.mono}>
              Enterprise
            </span>
            <div className="text-4xl font-bold text-[#fafafa] mt-2" style={font.display}>
              Custom
            </div>
            <p className="text-sm text-[#a1a1aa] mt-2 leading-relaxed" style={font.body}>
              For organizations that need SSO, compliance, and dedicated support with SLA guarantees.
            </p>
            <div className="mt-6 flex flex-col gap-2">
              {["SSO (SAML / OIDC)", "SOC 2 & GDPR tools", "99.9% SLA guarantee", "Dedicated support engineer", "Custom integrations"].map((f) => (
                <div key={f} className="flex items-center gap-2">
                  <Check size={14} className="text-[#7c3aed]" />
                  <span className="text-xs text-[#fafafa]" style={font.body}>{f}</span>
                </div>
              ))}
            </div>
            <a
              href="#cta"
              className="mt-6 block text-center px-4 py-2 text-sm font-semibold rounded-lg bg-[#7c3aed] text-white hover:bg-[#6d28d9] transition-colors"
              style={font.display}
            >
              Schedule a demo
            </a>
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

  const handleCopy = () => {
    navigator.clipboard.writeText(INSTALL_CMD);
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
                     radial-gradient(ellipse at 30% 80%, rgba(59,130,246,0.08) 0%, transparent 50%),
                     #09090b`,
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
          Give your team superpowers
        </motion.h2>

        <motion.p
          className="mt-4 text-lg text-[#a1a1aa] max-w-lg mx-auto"
          style={font.body}
          initial={{ opacity: 0, y: 10 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ ...ease, delay: 0.1 }}
        >
          Deploy with confidence. Scale with governance. Ship faster together.
        </motion.p>

        <motion.div
          className="mt-8"
          initial={{ opacity: 0, y: 15 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ ...ease, delay: 0.15 }}
        >
          <button
            onClick={handleCopy}
            className="w-full max-w-lg mx-auto flex items-center justify-between px-5 py-3.5 rounded-xl border border-white/[0.08] bg-[#111111] hover:border-[#7c3aed]/40 transition-colors group"
          >
            <span className="text-sm text-[#a78bfa]" style={font.mono}>
              $ {INSTALL_CMD}
            </span>
            {copied ? (
              <Check size={16} className="text-[#4ade80] shrink-0 ml-3" />
            ) : (
              <Copy size={16} className="text-[#71717a] group-hover:text-[#a1a1aa] transition-colors shrink-0 ml-3" />
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
              Start for free <ArrowRight size={16} />
            </a>
            <a
              href="#"
              className="px-6 py-2.5 rounded-lg border border-white/[0.08] text-[#fafafa] text-sm font-semibold hover:border-white/[0.16] transition-colors inline-flex items-center gap-2"
              style={font.display}
            >
              <Github size={16} /> Star on GitHub
            </a>
          </div>

          <span className="text-xs text-[#71717a]" style={font.mono}>
            Self-hosted &middot; Open Source &middot; MIT Licensed
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
      title: "Platform",
      links: ["Features", "Pricing", "Enterprise", "Changelog"],
    },
    {
      title: "Resources",
      links: ["Documentation", "API Reference", "Guides", "Blog"],
    },
    {
      title: "Company",
      links: ["About", "Security", "Compliance", "Contact"],
    },
  ];

  return (
    <footer className="px-5 py-12 bg-[#09090b] border-t border-white/[0.08]">
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
              Open source PaaS for teams that ship.
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
                    v.to === "/13"
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

          {/* Security */}
          <div>
            <h5 className="text-xs text-[#71717a] uppercase tracking-wider mb-3" style={font.mono}>
              Security
            </h5>
            <div className="flex flex-wrap gap-1.5 mb-3">
              {["SOC 2", "GDPR"].map((badge) => (
                <span
                  key={badge}
                  className="px-2 py-1 rounded text-[9px] font-medium bg-[#7c3aed]/10 text-[#a78bfa] border border-[#7c3aed]/20"
                  style={font.mono}
                >
                  {badge}
                </span>
              ))}
            </div>
            <p className="text-sm text-[#a1a1aa]" style={font.body}>
              Enterprise-ready security
            </p>
            <a
              href="#"
              className="text-xs text-[#7c3aed] hover:text-[#a78bfa] transition-colors mt-1 inline-block"
              style={font.body}
            >
              View security docs
            </a>
          </div>
        </div>

        {/* Bottom */}
        <div className="mt-10 pt-6 border-t border-white/[0.08] flex flex-wrap items-center justify-between gap-4">
          <span className="text-xs text-[#71717a]" style={font.mono}>
            &copy; 2026 otterdeploy &middot; MIT License
          </span>
          <span className="text-xs text-[#71717a] inline-flex items-center gap-1" style={font.mono}>
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
    <div className="bg-[#09090b] text-[#fafafa] min-h-screen" style={font.body}>
      <Nav />
      <Hero />
      <StatsRow />
      <BentoGrid />
      <FeatureTabs />
      <Community />
      <TwoColumns />
      <PricingGrid />
      <CTA />
      <Footer />
    </div>
  );
}
