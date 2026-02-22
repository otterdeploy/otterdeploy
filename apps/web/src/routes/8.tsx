import { createFileRoute, Link } from "@tanstack/react-router";
import { motion, useInView } from "motion/react";
import { useEffect, useRef, useState } from "react";
import {
  Users,
  Shield,
  Lock,
  ArrowRight,
  Copy,
  Check,
  Terminal,
  Eye,
  KeyRound,
  Building2,
  ScrollText,
  UserCheck,
  Network,
  Github,
  Twitter,
  CheckCircle,
  ChevronRight,
} from "lucide-react";

export const Route = createFileRoute("/8")({
  component: RouteComponent,
});

// ---------------------------------------------------------------------------
// Font Loader
// ---------------------------------------------------------------------------

function useFonts() {
  useEffect(() => {
    const id = "otter-teams-fonts";
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

const TEAM_GRID_CELLS = [
  { label: "web", r: 0, c: 0 },
  { label: "api", r: 0, c: 1 },
  { label: "worker", r: 0, c: 2 },
  { label: "db", r: 1, c: 0 },
  { label: "cache", r: 1, c: 1 },
  { label: "queue", r: 1, c: 2 },
  { label: "secrets", r: 2, c: 0 },
  { label: "logs", r: 2, c: 1 },
  { label: "config", r: 2, c: 2 },
];

const TEAM_SATELLITE_NODES = [
  { label: ".ADMIN", x: -100, y: -40 },
  { label: ".DEPLOY", x: 230, y: -50 },
  { label: ".VIEWER", x: 250, y: 120 },
  { label: ".AUDIT", x: -110, y: 80 },
  { label: ".SSO", x: -110, y: 160 },
];

const TERMINAL_LINES = [
  { text: "$ otter teams create frontend --org acme-corp", type: "command" as const, delay: 0 },
  { text: '\u2713 Team "frontend" created', type: "success" as const, delay: 0.5 },
  { text: "", type: "blank" as const, delay: 0.7 },
  { text: "$ otter rbac assign --team frontend --role deploy", type: "command" as const, delay: 0.9 },
  { text: '\u2713 Team "frontend" can deploy to staging, production', type: "success" as const, delay: 1.4 },
  { text: "", type: "blank" as const, delay: 1.6 },
  { text: "$ otter audit --last 24h", type: "command" as const, delay: 1.8 },
  { text: "TIME          USER     ACTION        RESOURCE", type: "header" as const, delay: 2.2 },
  { text: "14:23:01      sarah    deploy        web (production)", type: "row" as const, delay: 2.5 },
  { text: "14:20:15      mike     secret.set    API_KEY (staging)", type: "row" as const, delay: 2.7 },
  { text: "13:45:00      admin    team.create   frontend", type: "row" as const, delay: 2.9 },
  { text: "12:30:22      sarah    env.create    preview-123", type: "row" as const, delay: 3.1 },
  { text: "", type: "blank" as const, delay: 3.3 },
  { text: "\u2713 4 events in last 24h | 0 policy violations", type: "final" as const, delay: 3.5 },
];

const TAB_DATA = {
  teams: {
    label: "OTTER TEAMS",
    heading: "Organize by team",
    bullets: [
      "Create teams within organizations",
      "Assign members with granular roles",
      "Scope resources per team",
      "Team-level environment isolation",
    ],
    code: `$ otter teams list --org acme-corp

NAME        MEMBERS   ENVIRONMENTS
engineering    12     prod, staging, dev
platform        5     prod, staging
frontend        8     prod, staging, preview
data            3     prod, staging

\u2713 4 teams | 28 members | 0 inactive`,
  },
  rbac: {
    label: "OTTER RBAC",
    heading: "Fine-grained permissions",
    bullets: [
      "Predefined roles: Admin, Deploy, Read",
      "Custom permission policies",
      "Resource-level access control",
      "Inherit permissions from org to team",
    ],
    code: `$ otter rbac show --team frontend

ROLE      DEPLOY  SECRETS  CONFIG  AUDIT
admin     \u2713       \u2713        \u2713       \u2713
deploy    \u2713       read     read    read
viewer    -       -        read    read

$ otter rbac grant sarah --role deploy
\u2713 sarah can now deploy for team frontend`,
  },
  audit: {
    label: "OTTER AUDIT",
    heading: "Complete audit trail",
    bullets: [
      "Every action logged immutably",
      "Filter by user, action, or resource",
      "Export for compliance review",
      "Real-time event streaming",
    ],
    code: `$ otter audit --team frontend --format json

{
  "events": 142,
  "period": "30d",
  "top_actions": [
    { "action": "deploy",     "count": 68 },
    { "action": "secret.set", "count": 31 },
    { "action": "env.create", "count": 22 }
  ],
  "policy_violations": 0,
  "exported": "audit-2026-02.json"
}`,
  },
  sso: {
    label: "OTTER SSO",
    heading: "Enterprise identity",
    bullets: [
      "SAML 2.0 and OIDC support",
      "Auto-provision users from IdP",
      "Enforce MFA policies",
      "Just-in-time user provisioning",
    ],
    code: `$ otter sso configure --provider okta

\u25b8 Setting up SAML 2.0...
  \u2713 Metadata URL verified
  \u2713 Certificate imported
  \u2713 Attribute mapping configured
  \u2713 Default role: viewer

\u2713 SSO enabled for acme-corp
  Login: https://acme.otterdeploy.sh/sso`,
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
            href="#features"
            className="text-sm text-[#666666] hover:text-[#0a0a0a] transition-colors"
            style={{ ...font.body, fontWeight: 500 }}
          >
            Features
          </a>
          <a
            href="#pricing"
            className="text-sm text-[#666666] hover:text-[#0a0a0a] transition-colors"
            style={{ ...font.body, fontWeight: 500 }}
          >
            Pricing
          </a>
          <a
            href="#"
            className="text-sm text-[#666666] hover:text-[#0a0a0a] transition-colors"
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
                  v.to === "/8"
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
            Start for free
          </a>
        </div>
      </div>
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Isometric Diagram (Team-focused)
// ---------------------------------------------------------------------------

function IsometricDiagram() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-40px" });

  return (
    <div ref={ref} className="flex justify-center mt-20">
      <div className="relative" style={{ width: 500, height: 380 }}>
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
            {TEAM_GRID_CELLS.map((cell, i) => (
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

        {TEAM_SATELLITE_NODES.map((node, i) => (
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
          {TEAM_SATELLITE_NODES.map((node, i) => (
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
          className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-[#e5e5e5] bg-[#f3f0ff] mb-6"
          initial={{ opacity: 0, y: 10 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ ...ease, delay: 0.05 }}
        >
          <Users size={14} className="text-[#7c3aed]" />
          <span className="text-xs text-[#7c3aed] font-medium" style={font.mono}>
            Teams & Enterprise
          </span>
        </motion.div>

        <motion.h1
          className="text-5xl md:text-7xl font-extrabold text-[#0a0a0a] leading-[1.1] tracking-tight"
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
          className="mt-6 text-lg text-[#666666] max-w-2xl mx-auto leading-relaxed"
          style={{ ...font.body, fontWeight: 400 }}
          initial={{ opacity: 0, y: 15 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ ...ease, delay: 0.25 }}
        >
          Multi-tenant platform with role-based access, audit trails, and
          compliance built in. Your team deploys with confidence.
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
            Start for free <ArrowRight size={16} />
          </a>
          <a
            href="#pricing"
            className="px-6 py-2.5 text-sm font-semibold rounded-lg border border-[#e5e5e5] text-[#0a0a0a] hover:border-[#999999] transition-colors"
            style={font.display}
          >
            Talk to sales
          </a>
        </motion.div>

        <IsometricDiagram />
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Built for Growing Teams
// ---------------------------------------------------------------------------

function GrowingTeamsSection() {
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
            Built for growing teams
          </h2>
          <p
            className="mt-2 text-xl font-semibold text-[#0a0a0a]"
            style={font.display}
          >
            — from startup to enterprise.
          </p>
          <p
            className="mt-4 text-base text-[#666666] max-w-xl leading-relaxed"
            style={font.body}
          >
            Whether you're 5 developers or 500, Otterdeploy scales your
            infrastructure governance without slowing anyone down.
          </p>
        </motion.div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Dark Terminal — Team Workflow
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
        background: `radial-gradient(ellipse at 50% 0%, rgba(124,58,237,0.3) 0%, transparent 60%),
                     radial-gradient(ellipse at 30% 50%, rgba(59,130,246,0.2) 0%, transparent 50%),
                     radial-gradient(ellipse at 70% 50%, rgba(139,92,246,0.15) 0%, transparent 50%),
                     #0a0a0a`,
      }}
    >
      <div className="max-w-3xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={ease}
        >
          <TerminalWindow title="Terminal — team workflow">
            <div className="text-sm leading-relaxed min-h-[320px]">
              {TERMINAL_LINES.slice(0, visibleLines).map((line, i) => (
                <div key={i} className="whitespace-pre">
                  {line.type === "command" && (
                    <span className="text-[#fafafa]">{line.text}</span>
                  )}
                  {line.type === "blank" && <br />}
                  {line.type === "header" && (
                    <span className="text-[#999999]">{line.text}</span>
                  )}
                  {line.type === "row" && (
                    <span className="text-[#a78bfa]">{line.text}</span>
                  )}
                  {line.type === "success" && (
                    <span className="text-[#4ade80]">{line.text}</span>
                  )}
                  {line.type === "final" && (
                    <span className="text-[#4ade80] font-medium">
                      {line.text}
                    </span>
                  )}
                </div>
              ))}
              {visibleLines < TERMINAL_LINES.length && inView && (
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
// Bento Grid — Team Features
// ---------------------------------------------------------------------------

function BentoGrid() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });

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
          Governance without friction
        </motion.h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {/* RBAC — col-span-2 */}
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
                Granular role-based access
              </h3>
            </div>
            <p
              className="text-sm text-[#666666] mb-4 leading-relaxed"
              style={font.body}
            >
              Define exactly who can deploy, read secrets, or manage
              configuration. Roles cascade from organization to team.
            </p>
            {/* Role hierarchy visual */}
            <div className="rounded-lg border border-[#e5e5e5] bg-[#f8f8f8] p-4">
              <div className="flex items-center gap-3 mb-3">
                <span className="px-2.5 py-1 rounded text-xs font-medium bg-[#7c3aed]/10 text-[#7c3aed] border border-[#7c3aed]/20" style={font.mono}>Admin</span>
                <ChevronRight size={14} className="text-[#999999]" />
                <span className="px-2.5 py-1 rounded text-xs font-medium bg-[#7c3aed]/10 text-[#7c3aed] border border-[#7c3aed]/20" style={font.mono}>Deploy</span>
                <ChevronRight size={14} className="text-[#999999]" />
                <span className="px-2.5 py-1 rounded text-xs font-medium bg-[#7c3aed]/10 text-[#7c3aed] border border-[#7c3aed]/20" style={font.mono}>Read</span>
              </div>
              <div className="grid grid-cols-4 gap-px text-[10px] rounded overflow-hidden border border-[#e5e5e5]" style={font.mono}>
                <div className="bg-[#f8f8f8] p-2 text-[#999999] font-medium">Permission</div>
                <div className="bg-[#f8f8f8] p-2 text-[#999999] font-medium text-center">Admin</div>
                <div className="bg-[#f8f8f8] p-2 text-[#999999] font-medium text-center">Deploy</div>
                <div className="bg-[#f8f8f8] p-2 text-[#999999] font-medium text-center">Read</div>
                {[
                  ["deploy", true, true, false],
                  ["secrets", true, false, false],
                  ["config", true, true, true],
                  ["audit", true, true, true],
                ].map(([perm, admin, deploy, read], i) => (
                  <div key={i} className="contents">
                    <div className="bg-white p-2 text-[#666666]">{perm as string}</div>
                    <div className="bg-white p-2 text-center">{admin ? <span className="text-[#4ade80]">{"\u2713"}</span> : <span className="text-[#e5e5e5]">-</span>}</div>
                    <div className="bg-white p-2 text-center">{deploy ? <span className="text-[#4ade80]">{"\u2713"}</span> : <span className="text-[#e5e5e5]">-</span>}</div>
                    <div className="bg-white p-2 text-center">{read ? <span className="text-[#4ade80]">{"\u2713"}</span> : <span className="text-[#e5e5e5]">-</span>}</div>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>

          {/* Multi-tenancy — 1x1 */}
          <motion.div
            className="rounded-xl border border-[#e5e5e5] bg-white p-6 hover:border-[#7c3aed]/30 transition-colors"
            initial={{ opacity: 0, scale: 0.97 }}
            animate={inView ? { opacity: 1, scale: 1 } : {}}
            transition={{ ...ease, delay: 0.1 }}
          >
            <div className="flex items-center gap-2 mb-2">
              <Building2 size={18} className="text-[#7c3aed]" />
              <h3
                className="text-base font-semibold text-[#0a0a0a]"
                style={font.display}
              >
                Organizations and teams
              </h3>
            </div>
            <p
              className="text-sm text-[#666666] mb-4 leading-relaxed"
              style={font.body}
            >
              Multi-tenant by design. Isolate resources across orgs and teams.
            </p>
            {/* Org tree */}
            <div className="text-xs leading-relaxed" style={font.mono}>
              <div className="text-[#0a0a0a] font-medium">Acme Corp</div>
              <div className="ml-4 mt-1 flex flex-col gap-1">
                <div className="flex items-center gap-1.5">
                  <span className="text-[#e5e5e5]">{"\u251C\u2500"}</span>
                  <span className="text-[#7c3aed]">Engineering</span>
                  <span className="text-[#999999] ml-auto">12</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-[#e5e5e5]">{"\u251C\u2500"}</span>
                  <span className="text-[#7c3aed]">Platform</span>
                  <span className="text-[#999999] ml-auto">5</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-[#e5e5e5]">{"\u2514\u2500"}</span>
                  <span className="text-[#7c3aed]">Frontend</span>
                  <span className="text-[#999999] ml-auto">8</span>
                </div>
              </div>
            </div>
          </motion.div>

          {/* Audit Trails — 1x1 */}
          <motion.div
            className="rounded-xl border border-[#e5e5e5] bg-white p-6 hover:border-[#7c3aed]/30 transition-colors"
            initial={{ opacity: 0, scale: 0.97 }}
            animate={inView ? { opacity: 1, scale: 1 } : {}}
            transition={{ ...ease, delay: 0.15 }}
          >
            <div className="flex items-center gap-2 mb-2">
              <ScrollText size={18} className="text-[#7c3aed]" />
              <h3
                className="text-base font-semibold text-[#0a0a0a]"
                style={font.display}
              >
                Every action logged
              </h3>
            </div>
            <p
              className="text-sm text-[#666666] mb-4 leading-relaxed"
              style={font.body}
            >
              Immutable audit trail for compliance and debugging.
            </p>
            {/* Mini audit log */}
            <div className="text-[10px] leading-relaxed space-y-1" style={font.mono}>
              {[
                { time: "14:23", user: "sarah", action: "deploy" },
                { time: "14:20", user: "mike", action: "secret.set" },
                { time: "13:45", user: "admin", action: "team.create" },
              ].map((row, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-[#999999] w-10">{row.time}</span>
                  <span className="text-[#0a0a0a] w-10">{row.user}</span>
                  <span className="text-[#7c3aed]">{row.action}</span>
                </div>
              ))}
            </div>
          </motion.div>

          {/* SSO Integration — col-span-2 */}
          <motion.div
            className="md:col-span-2 rounded-xl border border-[#e5e5e5] bg-white p-6 hover:border-[#7c3aed]/30 transition-colors"
            initial={{ opacity: 0, scale: 0.97 }}
            animate={inView ? { opacity: 1, scale: 1 } : {}}
            transition={{ ...ease, delay: 0.2 }}
          >
            <div className="flex items-center gap-2 mb-2">
              <KeyRound size={18} className="text-[#7c3aed]" />
              <h3
                className="text-base font-semibold text-[#0a0a0a]"
                style={font.display}
              >
                Connect your identity provider
              </h3>
            </div>
            <p
              className="text-sm text-[#666666] mb-4 leading-relaxed"
              style={font.body}
            >
              Single sign-on with your existing identity provider. SAML 2.0 and
              OIDC supported out of the box.
            </p>
            <div className="flex flex-wrap gap-2 mb-4">
              {["Okta", "Auth0", "Azure AD", "Google Workspace"].map((provider) => (
                <span
                  key={provider}
                  className="px-3 py-1.5 rounded-md text-xs font-medium bg-[#f3f0ff] text-[#7c3aed] border border-[#7c3aed]/15"
                  style={font.mono}
                >
                  {provider}
                </span>
              ))}
            </div>
            <div
              className="rounded-lg bg-[#0a0a0a] p-3 text-[11px] leading-relaxed"
              style={font.mono}
            >
              <div className="text-[#fafafa]">$ otter sso configure --provider okta</div>
              <div className="text-[#4ade80] mt-1">{"\u2713"} SSO enabled for acme-corp</div>
              <div className="text-[#999999]">  Login: https://acme.otterdeploy.sh/sso</div>
            </div>
          </motion.div>

          {/* Compliance — 1x1 */}
          <motion.div
            className="rounded-xl border border-[#e5e5e5] bg-white p-6 hover:border-[#7c3aed]/30 transition-colors"
            initial={{ opacity: 0, scale: 0.97 }}
            animate={inView ? { opacity: 1, scale: 1 } : {}}
            transition={{ ...ease, delay: 0.25 }}
          >
            <div className="flex items-center gap-2 mb-2">
              <CheckCircle size={18} className="text-[#7c3aed]" />
              <h3
                className="text-base font-semibold text-[#0a0a0a]"
                style={font.display}
              >
                SOC 2, GDPR ready
              </h3>
            </div>
            <p
              className="text-sm text-[#666666] mb-4 leading-relaxed"
              style={font.body}
            >
              Compliance-ready infrastructure with built-in controls.
            </p>
            <div className="flex flex-wrap gap-2">
              {["SOC 2", "GDPR", "HIPAA", "ISO 27001"].map((badge) => (
                <span
                  key={badge}
                  className="px-2.5 py-1 rounded text-[10px] font-medium bg-[#4ade80]/10 text-[#16a34a] border border-[#4ade80]/20 inline-flex items-center gap-1"
                  style={font.mono}
                >
                  <Check size={10} />
                  {badge}
                </span>
              ))}
            </div>
          </motion.div>

          {/* Secrets Scoping — 1x1 */}
          <motion.div
            className="rounded-xl border border-[#e5e5e5] bg-white p-6 hover:border-[#7c3aed]/30 transition-colors"
            initial={{ opacity: 0, scale: 0.97 }}
            animate={inView ? { opacity: 1, scale: 1 } : {}}
            transition={{ ...ease, delay: 0.3 }}
          >
            <div className="flex items-center gap-2 mb-2">
              <Lock size={18} className="text-[#7c3aed]" />
              <h3
                className="text-base font-semibold text-[#0a0a0a]"
                style={font.display}
              >
                Per-team, per-environment secrets
              </h3>
            </div>
            <p
              className="text-sm text-[#666666] mb-3 leading-relaxed"
              style={font.body}
            >
              Encrypted secrets scoped to team and environment. No leakage.
            </p>
            {/* Scoping diagram */}
            <div className="text-[10px] space-y-1.5" style={font.mono}>
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 bg-[#f3f0ff] text-[#7c3aed] rounded border border-[#7c3aed]/15">frontend</span>
                <span className="text-[#999999]">{"\u2192"}</span>
                <span className="px-2 py-0.5 bg-[#f8f8f8] text-[#666666] rounded border border-[#e5e5e5]">prod</span>
                <span className="text-[#999999]">{"\u2192"}</span>
                <span className="text-[#4ade80]">API_KEY</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 bg-[#f3f0ff] text-[#7c3aed] rounded border border-[#7c3aed]/15">frontend</span>
                <span className="text-[#999999]">{"\u2192"}</span>
                <span className="px-2 py-0.5 bg-[#f8f8f8] text-[#666666] rounded border border-[#e5e5e5]">staging</span>
                <span className="text-[#999999]">{"\u2192"}</span>
                <span className="text-[#22d3ee]">API_KEY</span>
              </div>
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
  const [activeTab, setActiveTab] = useState<TabKey>("teams");

  const tabIcons: Record<TabKey, React.ReactNode> = {
    teams: <Users size={16} />,
    rbac: <Shield size={16} />,
    audit: <ScrollText size={16} />,
    sso: <KeyRound size={16} />,
  };

  const data = TAB_DATA[activeTab];

  return (
    <section
      ref={ref}
      className="py-24 px-5"
      style={{
        background: `radial-gradient(ellipse at 50% 0%, rgba(124,58,237,0.3) 0%, transparent 60%),
                     radial-gradient(ellipse at 30% 50%, rgba(59,130,246,0.2) 0%, transparent 50%),
                     radial-gradient(ellipse at 70% 50%, rgba(139,92,246,0.15) 0%, transparent 50%),
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
          Collaboration built in
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
                if (line.startsWith("$")) {
                  return (
                    <div key={i} className="text-[#fafafa]">{line}</div>
                  );
                }
                if (line.startsWith("\u25b8")) {
                  return (
                    <div key={i} className="text-[#999999]">{line}</div>
                  );
                }
                if (line.includes("\u2713")) {
                  return (
                    <div key={i} className="text-[#4ade80]">{line}</div>
                  );
                }
                if (line.trim().startsWith("{") || line.trim().startsWith("}") || line.trim().startsWith("[") || line.trim().startsWith("]") || line.trim().startsWith('"')) {
                  return (
                    <div key={i}>
                      <span className="text-[#a78bfa]">{line}</span>
                    </div>
                  );
                }
                if (line.includes("NAME") || line.includes("ROLE") || line.includes("TIME")) {
                  return (
                    <div key={i} className="text-[#999999]">{line}</div>
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
  { value: "500+", label: "teams" },
  { value: "99.9%", label: "uptime SLA" },
  { value: "0", label: "policy violations" },
  { value: "100%", label: "audit coverage" },
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

  const teamBullets = [
    "One-command onboarding for new team members",
    "Self-service environments with guardrails",
    "Granular permissions cascade from org to team",
    "Deploy previews scoped to team branches",
    "Automatic cleanup of stale environments",
  ];

  const securityBullets = [
    "SOC 2 Type II certified infrastructure",
    "AES-256 encryption at rest and in transit",
    "Network isolation between tenant services",
    "Annual third-party penetration testing",
    "GDPR data residency controls",
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
            Scale your team, not your ops burden
          </h3>
          <ul className="flex flex-col gap-3">
            {teamBullets.map((b) => (
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
            Enterprise-grade security
          </h3>
          <ul className="flex flex-col gap-3">
            {securityBullets.map((b) => (
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
// Pricing Grid — Enterprise Emphasis
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
      <div className="max-w-5xl mx-auto">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {/* Community */}
          <motion.div
            className="rounded-xl border border-[#e5e5e5] p-8"
            initial={{ opacity: 0, y: 15 }}
            animate={inView ? { opacity: 1, y: 0 } : {}}
            transition={{ ...ease, delay: 0.05 }}
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
            <p className="text-sm text-[#666666] mt-2 mb-6" style={font.body}>
              All core features, unlimited deploys, community support.
            </p>
            <ul className="flex flex-col gap-2">
              {["Unlimited deploys", "3 team members", "Community support", "Basic RBAC"].map((item) => (
                <li key={item} className="flex items-center gap-2 text-sm text-[#666666]" style={font.body}>
                  <Check size={14} className="text-[#4ade80] shrink-0" />
                  {item}
                </li>
              ))}
            </ul>
          </motion.div>

          {/* Pro */}
          <motion.div
            className="rounded-xl border border-[#e5e5e5] p-8"
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
            <div className="mt-2">
              <span
                className="text-4xl font-bold text-[#0a0a0a]"
                style={font.display}
              >
                $29
              </span>
              <span className="text-sm text-[#999999] ml-1">/mo</span>
            </div>
            <p className="text-sm text-[#666666] mt-2 mb-6" style={font.body}>
              Priority support, advanced RBAC, SSO, audit logs.
            </p>
            <ul className="flex flex-col gap-2">
              {["Everything in Community", "Unlimited team members", "Advanced RBAC", "Audit logs", "Priority support"].map((item) => (
                <li key={item} className="flex items-center gap-2 text-sm text-[#666666]" style={font.body}>
                  <Check size={14} className="text-[#4ade80] shrink-0" />
                  {item}
                </li>
              ))}
            </ul>
          </motion.div>

          {/* Enterprise — highlighted */}
          <motion.div
            className="rounded-xl border-2 border-[#7c3aed] p-8 relative"
            initial={{ opacity: 0, y: 15 }}
            animate={inView ? { opacity: 1, y: 0 } : {}}
            transition={{ ...ease, delay: 0.15 }}
          >
            <span className="absolute -top-3 left-6 px-3 py-0.5 bg-[#7c3aed] text-white text-[10px] font-medium rounded-full" style={font.mono}>
              RECOMMENDED
            </span>
            <span
              className="text-xs text-[#7c3aed] uppercase tracking-wider font-medium"
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
            <p className="text-sm text-[#666666] mt-2 mb-6" style={font.body}>
              Dedicated support, SLA guarantees, custom SSO, on-premises
              deployment, compliance certifications.
            </p>
            <ul className="flex flex-col gap-2">
              {[
                "Everything in Pro",
                "Dedicated support engineer",
                "99.99% uptime SLA",
                "Custom SSO / SAML",
                "On-premises deployment",
                "SOC 2 & GDPR compliance",
                "Custom integrations",
              ].map((item) => (
                <li key={item} className="flex items-center gap-2 text-sm text-[#666666]" style={font.body}>
                  <Check size={14} className="text-[#7c3aed] shrink-0" />
                  {item}
                </li>
              ))}
            </ul>
            <a
              href="#"
              className="mt-6 w-full inline-flex items-center justify-center px-4 py-2.5 text-sm font-semibold rounded-lg bg-[#7c3aed] text-white hover:bg-[#6d28d9] transition-colors"
              style={font.display}
            >
              Contact sales
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
        background: `radial-gradient(ellipse at 50% 20%, rgba(124,58,237,0.3) 0%, transparent 60%),
                     radial-gradient(ellipse at 30% 80%, rgba(59,130,246,0.15) 0%, transparent 50%),
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
          Give your team superpowers
        </motion.h2>

        <motion.p
          className="mt-4 text-[#999999] text-base leading-relaxed"
          style={font.body}
          initial={{ opacity: 0, y: 10 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ ...ease, delay: 0.1 }}
        >
          Deploy, govern, and scale your infrastructure with confidence.
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
              className="px-6 py-2.5 rounded-lg bg-[#7c3aed] text-white text-sm font-semibold hover:bg-[#6d28d9] transition-colors inline-flex items-center gap-2"
              style={font.display}
            >
              Start free <ArrowRight size={16} />
            </a>
            <a
              href="#"
              className="px-6 py-2.5 rounded-lg border border-[#404040] text-[#fafafa] text-sm font-semibold hover:border-[#525252] transition-colors"
              style={font.display}
            >
              Schedule a demo
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
      title: "Enterprise",
      links: ["Security", "Compliance", "SSO", "SLA"],
    },
    {
      title: "Community",
      links: ["GitHub", "Discord", "Blog", "Contributing"],
    },
  ];

  return (
    <footer className="px-5 py-12 bg-[#0a0a0a] border-t border-[#262626]">
      <div className="max-w-7xl mx-auto">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
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
                    v.to === "/8"
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

        <div className="mt-10 pt-6 border-t border-[#262626] flex flex-wrap items-center justify-between gap-4">
          <span className="text-xs text-[#666666]" style={font.mono}>
            &copy; 2026 otterdeploy
          </span>
          <span className="text-xs text-[#666666]" style={font.mono}>
            infrastructure your team can trust
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
      <GrowingTeamsSection />
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
