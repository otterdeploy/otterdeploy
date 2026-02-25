import { createFileRoute, Link } from "@tanstack/react-router";
import { motion, useInView } from "motion/react";
import { useEffect, useRef } from "react";
import {
  FileCode, GitBranch, Rocket, Check, Github, Terminal,
  BookOpen, ArrowRight, Shield, Users, Lock, ScrollText,
  Server, Database, HardDrive,
} from "lucide-react";

export const Route = createFileRoute("/4")({ component: RouteComponent });

/* ---- animation helpers ---- */

function FadeUp({ children, delay = 0, className = "" }: { children: React.ReactNode; delay?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-60px" });
  return (
    <motion.div ref={ref} initial={{ opacity: 0, y: 28 }} animate={inView ? { opacity: 1, y: 0 } : {}} transition={{ duration: 0.6, ease: "easeOut", delay }} className={className}>
      {children}
    </motion.div>
  );
}

function SlideIn({ children, delay = 0, direction = "left", className = "" }: { children: React.ReactNode; delay?: number; direction?: "left" | "right"; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-60px" });
  return (
    <motion.div ref={ref} initial={{ opacity: 0, x: direction === "left" ? -40 : 40 }} animate={inView ? { opacity: 1, x: 0 } : {}} transition={{ duration: 0.7, ease: "easeOut", delay }} className={className}>
      {children}
    </motion.div>
  );
}

/* ---- data ---- */

const NAV = ["Docs", "Features", "Pricing", "GitHub"];
const VARIANTS = [
  { l: "I", to: "/1" }, { l: "II", to: "/2" }, { l: "III", to: "/3" },
  { l: "IV", to: "/4" }, { l: "V", to: "/5" },
];
const FOOTER_COLS = [
  { title: "Product", links: ["Features", "Pricing", "Changelog", "Roadmap"] },
  { title: "Resources", links: ["Documentation", "Guides", "API Reference", "Status"] },
  { title: "Community", links: ["GitHub", "Discord", "Blog", "Contributing"] },
];

/* ---- color tokens ---- */

const BG = "#fafaf9";
const SURFACE = "#f5f5f4";
const BORDER = "#e7e5e4";
const TEXT1 = "#1c1917";
const TEXT2 = "#78716c";
const MUTED = "#a8a29e";
const TEAL = "#0d9488";
const TEAL_L = "#14b8a6";
const TEAL_D = "#0f766e";
const DARK = "#0c0a09";
const DARK_T = "#fafaf9";
const G = "#4ade80";
const TT = "#2dd4bf";
const TT_L = "#5eead4";

/* ---- main ---- */

function RouteComponent() {
  useEffect(() => {
    const id = "teal-tide-fonts";
    if (document.getElementById(id)) return;
    const el = document.createElement("link");
    el.id = id;
    el.rel = "stylesheet";
    el.href = "https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=Fira+Code:wght@400&display=swap";
    document.head.appendChild(el);
  }, []);

  return (
    <div className="min-h-screen overflow-x-hidden" style={{ fontFamily: "'Manrope', sans-serif", background: BG, color: TEXT1 }}>
      <style>{`.font-mono{font-family:'Fira Code',monospace}`}</style>
      <NavBar />
      <HeroSection />
      <FeatureRow />
      <HowItWorks />
      <SplitDeclarative />
      <SplitGitDeploy />
      <SplitDashboard />
      <StatsStrip />
      <BuiltForTeams />
      <PricingSection />
      <CTASection />
      <Footer />
    </div>
  );
}

/* ---- navigation ---- */

function NavBar() {
  return (
    <nav className="fixed top-0 right-0 left-0 z-50 border-b" style={{ background: "rgba(250,250,249,0.92)", borderColor: BORDER, backdropFilter: "blur(16px)" }}>
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3.5">
        <Link to="/4" className="text-lg font-bold tracking-tight" style={{ color: TEXT1 }}>
          otterdeploy
        </Link>
        <div className="hidden items-center gap-7 md:flex">
          {NAV.map((l) => (
            <a key={l} href={`#${l.toLowerCase()}`} className="text-sm font-medium transition-colors hover:text-stone-900" style={{ color: TEXT2 }}>
              {l}
            </a>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <div className="hidden items-center gap-1.5 sm:flex">
            {VARIANTS.map((v) => (
              <Link key={v.to} to={v.to} className="flex h-7 w-7 items-center justify-center rounded-md text-xs font-semibold transition-colors"
                style={{ color: v.to === "/4" ? "#fff" : MUTED, background: v.to === "/4" ? TEAL : "transparent" }}>
                {v.l}
              </Link>
            ))}
          </div>
          <a href="#cta" className="rounded-lg px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90" style={{ background: TEAL }}>
            Start Free
          </a>
        </div>
      </div>
    </nav>
  );
}

/* ---- hero ---- */

function HeroSection() {
  return (
    <section className="px-6 pt-32 pb-20" style={{ background: BG }}>
      <div className="mx-auto max-w-4xl text-center">
        <FadeUp>
          <span className="mb-6 inline-block rounded-full px-4 py-1.5 text-xs font-semibold uppercase tracking-wider"
            style={{ background: "rgba(13,148,136,0.1)", color: TEAL }}>
            Open Source
          </span>
        </FadeUp>

        <FadeUp delay={0.1}>
          <h1 className="mb-6 text-5xl leading-[1.08] font-extrabold tracking-tight md:text-7xl">
            Ship infrastructure<br />like <span style={{ color: TEAL }}>code</span>
          </h1>
        </FadeUp>

        <FadeUp delay={0.2}>
          <p className="mx-auto mt-6 mb-10 max-w-xl text-xl leading-relaxed" style={{ color: TEXT2 }}>
            Declarative, git-driven, self-hosted. Otterdeploy turns config files into running infrastructure.
          </p>
        </FadeUp>

        <FadeUp delay={0.3}>
          <div className="flex flex-wrap items-center justify-center gap-4">
            <a href="#cta" className="inline-flex items-center gap-2 rounded-lg px-6 py-3 text-sm font-semibold text-white transition-opacity hover:opacity-90" style={{ background: TEAL }}>
              Quick Start <ArrowRight size={16} />
            </a>
            <a href="#github" className="inline-flex items-center gap-2 rounded-lg px-6 py-3 text-sm font-medium" style={{ background: "#e7e5e4", color: TEXT1 }}>
              <Github size={16} /> View on GitHub
            </a>
          </div>
        </FadeUp>

        {/* Config code block */}
        <FadeUp delay={0.45}>
          <div className="mx-auto mt-16 max-w-2xl overflow-hidden rounded-xl border text-left" style={{ borderColor: BORDER }}>
            <div className="flex items-center border-b px-1" style={{ borderColor: BORDER, background: SURFACE }}>
              <button className="font-mono relative px-4 py-3 text-xs font-medium" style={{ color: TEAL }}>
                otterdeploy.yml
                <span className="absolute right-0 bottom-0 left-0 h-[2px]" style={{ background: TEAL }} />
              </button>
              <button className="font-mono px-4 py-3 text-xs" style={{ color: MUTED }}>Dockerfile</button>
            </div>
            <pre className="font-mono overflow-x-auto p-5 text-xs leading-[1.8] sm:text-sm" style={{ background: "#fff", color: TEXT1 }}>
              <span style={{ color: TEAL }}>project</span>{": my-saas-app\n"}
              <span style={{ color: TEAL }}>version</span>{': "2.0"\n\n'}
              <span style={{ color: TEAL }}>services</span>{":\n"}
              {"  "}<span style={{ color: TEAL_D }}>api</span>{":\n"}
              {"    "}<span style={{ color: MUTED }}>image</span>{": node:20-alpine\n"}
              {"    "}<span style={{ color: MUTED }}>port</span>{": "}<span style={{ color: TEAL_L }}>3000</span>{"\n"}
              {"    "}<span style={{ color: MUTED }}>replicas</span>{": "}<span style={{ color: TEAL_L }}>3</span>{"\n"}
              {"    "}<span style={{ color: TEAL }}>health</span>{": /api/health\n\n"}
              {"  "}<span style={{ color: TEAL_D }}>web</span>{":\n"}
              {"    "}<span style={{ color: MUTED }}>build</span>{": ./apps/web\n"}
              {"    "}<span style={{ color: MUTED }}>port</span>{": "}<span style={{ color: TEAL_L }}>8080</span>{"\n\n"}
              <span style={{ color: TEAL }}>databases</span>{":\n"}
              {"  "}<span style={{ color: TEAL_D }}>postgres</span>{":\n"}
              {"    "}<span style={{ color: MUTED }}>engine</span>{": pg "}<span style={{ color: TEAL_L }}>16</span>{"\n"}
              {"    "}<span style={{ color: MUTED }}>storage</span>{": "}<span style={{ color: TEAL_L }}>20</span>{"Gi"}
            </pre>
          </div>
        </FadeUp>
      </div>
    </section>
  );
}

/* ---- feature row (3 columns, border-separated) ---- */

function FeatureRow() {
  const feats = [
    { title: "Config as Code", desc: "Define your stack declaratively", badges: ["YAML", "TOML"] },
    { title: "Multi-Environment", desc: "Dev, staging, production with inheritance", envs: [{ l: "prod", c: G }, { l: "staging", c: "#facc15" }, { l: "dev", c: TT }] },
    { title: "Real-time Visibility", desc: "See everything as it happens", pulse: true },
  ];

  return (
    <section style={{ borderTop: `1px solid ${BORDER}`, borderBottom: `1px solid ${BORDER}` }}>
      <div className="mx-auto grid max-w-6xl grid-cols-1 md:grid-cols-3">
        {feats.map((f, i) => (
          <FadeUp key={f.title} delay={i * 0.1}>
            <div className="px-8 py-12" style={{ borderRight: i < 2 ? `1px solid ${BORDER}` : "none" }}>
              <h3 className="mb-2 text-lg font-bold">{f.title}</h3>
              <p className="mb-4 text-sm" style={{ color: TEXT2 }}>{f.desc}</p>

              {f.badges && (
                <div className="flex gap-2">
                  {f.badges.map((b) => (
                    <span key={b} className="font-mono rounded px-2.5 py-1 text-xs font-medium" style={{ background: "rgba(13,148,136,0.1)", color: TEAL }}>{b}</span>
                  ))}
                </div>
              )}

              {f.envs && (
                <div className="flex flex-wrap gap-2">
                  {f.envs.map((e) => (
                    <span key={e.l} className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium" style={{ background: SURFACE, borderColor: BORDER }}>
                      <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: e.c }} />{e.l}
                    </span>
                  ))}
                </div>
              )}

              {f.pulse && (
                <div className="flex items-center gap-3">
                  {[0, 0.3, 0.6].map((d) => (
                    <motion.span key={d} className="inline-block h-2 w-2 rounded-full" style={{ background: TEAL }}
                      animate={{ opacity: [1, 0.3, 1] }} transition={{ duration: 1.5, repeat: Infinity, delay: d }} />
                  ))}
                  <span className="text-xs" style={{ color: MUTED }}>streaming</span>
                </div>
              )}
            </div>
          </FadeUp>
        ))}
      </div>
    </section>
  );
}

/* ---- how it works (dark section) ---- */

function HowItWorks() {
  const steps = [
    { num: "01", icon: FileCode, title: "Define", desc: "Write your infrastructure config" },
    { num: "02", icon: GitBranch, title: "Push", desc: "Push to your git repository" },
    { num: "03", icon: Rocket, title: "Live", desc: "Services deploy automatically" },
  ];

  return (
    <section className="relative px-6 py-24" style={{
      background: `radial-gradient(ellipse at 50% 20%, rgba(13,148,136,0.25) 0%, transparent 60%),
                   radial-gradient(ellipse at 30% 60%, rgba(20,184,166,0.15) 0%, transparent 50%), ${DARK}`,
    }}>
      <div className="mx-auto max-w-4xl">
        <FadeUp>
          <h2 className="mb-16 text-center text-4xl font-bold tracking-tight" style={{ color: DARK_T }}>How it works</h2>
        </FadeUp>

        <div className="relative grid grid-cols-1 gap-12 md:grid-cols-3 md:gap-8">
          <div className="pointer-events-none absolute top-8 right-[17%] left-[17%] hidden h-px md:block" style={{ borderTop: "1px dashed #57534e" }} />

          {steps.map((s, i) => {
            const Icon = s.icon;
            return (
              <FadeUp key={s.num} delay={i * 0.15}>
                <div className="flex flex-col items-center text-center">
                  <div className="relative z-10 mb-4 flex h-16 w-16 items-center justify-center rounded-2xl" style={{ background: "rgba(13,148,136,0.15)" }}>
                    <Icon size={28} style={{ color: TT }} />
                  </div>
                  <span className="font-mono mb-2 text-sm font-medium" style={{ color: TEAL_L }}>{s.num}</span>
                  <h3 className="mb-2 text-xl font-bold" style={{ color: DARK_T }}>{s.title}</h3>
                  <p className="text-sm" style={{ color: MUTED }}>{s.desc}</p>
                </div>
              </FadeUp>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/* ---- split: declarative configuration ---- */

function SplitDeclarative() {
  return (
    <section className="px-6 py-24" style={{ borderBottom: `1px solid ${BORDER}` }}>
      <div className="mx-auto grid max-w-6xl items-center gap-16 lg:grid-cols-2">
        <SlideIn direction="left">
          <span className="font-mono mb-4 inline-block text-xs font-medium uppercase tracking-wider" style={{ color: TEAL }}>OTTER CONFIG</span>
          <h2 className="mb-4 text-3xl font-bold tracking-tight">One file. Entire stack.</h2>
          <p className="mb-6 text-sm leading-relaxed" style={{ color: TEXT2 }}>
            Describe your entire infrastructure in a single declarative configuration file. Otterdeploy validates, provisions, and connects everything for you.
          </p>
          <ul className="space-y-3">
            {["Services, databases, volumes in one place", "Environment inheritance with overrides", "Type-safe validation", "GitOps-friendly"].map((b) => (
              <li key={b} className="flex items-center gap-3 text-sm"><Check size={16} style={{ color: TEAL }} />{b}</li>
            ))}
          </ul>
        </SlideIn>

        <SlideIn direction="right" delay={0.15}>
          <div className="overflow-hidden rounded-xl border" style={{ borderColor: BORDER }}>
            <div className="flex items-center border-b px-4 py-2.5" style={{ borderColor: BORDER, background: SURFACE }}>
              <span className="font-mono text-xs" style={{ color: TEXT2 }}>otterdeploy.yml</span>
            </div>
            <pre className="font-mono overflow-x-auto p-5 text-xs leading-[1.8] sm:text-sm" style={{ background: "#fff", color: TEXT1 }}>
              <span style={{ color: TEAL }}>project</span>{": my-app\n\n"}
              <span style={{ color: TEAL }}>services</span>{":\n"}
              {"  "}<span style={{ color: TEAL_D }}>api</span>{":\n"}
              {"    "}<span style={{ color: MUTED }}>type</span>{": web\n"}
              {"    "}<span style={{ color: MUTED }}>build</span>{": ./api\n"}
              {"    "}<span style={{ color: MUTED }}>port</span>{": "}<span style={{ color: TEAL_L }}>3000</span>{"\n"}
              {"    "}<span style={{ color: MUTED }}>replicas</span>{": "}<span style={{ color: TEAL_L }}>2</span>{"\n\n"}
              {"  "}<span style={{ color: TEAL_D }}>worker</span>{":\n"}
              {"    "}<span style={{ color: MUTED }}>type</span>{": worker\n"}
              {"    "}<span style={{ color: MUTED }}>build</span>{": ./worker\n"}
              {"    "}<span style={{ color: MUTED }}>command</span>{": bun run start\n\n"}
              <span style={{ color: TEAL }}>databases</span>{":\n"}
              {"  "}<span style={{ color: TEAL_D }}>main</span>{":\n"}
              {"    "}<span style={{ color: MUTED }}>engine</span>{": postgres "}<span style={{ color: TEAL_L }}>16</span>{"\n"}
              {"    "}<span style={{ color: MUTED }}>storage</span>{": "}<span style={{ color: TEAL_L }}>10</span>{"Gi\n\n"}
              <span style={{ color: TEAL }}>cache</span>{":\n"}
              {"  "}<span style={{ color: TEAL_D }}>sessions</span>{":\n"}
              {"    "}<span style={{ color: MUTED }}>engine</span>{": redis "}<span style={{ color: TEAL_L }}>7</span>
            </pre>
          </div>
        </SlideIn>
      </div>
    </section>
  );
}

/* ---- split: git-driven deploys (reversed layout) ---- */

function SplitGitDeploy() {
  return (
    <section className="px-6 py-24" style={{ borderBottom: `1px solid ${BORDER}` }}>
      <div className="mx-auto grid max-w-6xl items-center gap-16 lg:grid-cols-2">
        {/* Left: dark terminal */}
        <SlideIn direction="left" delay={0.15}>
          <div className="overflow-hidden rounded-xl" style={{
            background: `radial-gradient(ellipse at 30% 30%, rgba(13,148,136,0.2) 0%, transparent 60%), ${DARK}`,
          }}>
            <div className="flex items-center gap-2 border-b px-4 py-3" style={{ borderColor: "#292524" }}>
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: "#ef4444" }} />
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: "#facc15" }} />
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: G }} />
              <span className="font-mono ml-3 text-xs" style={{ color: "#57534e" }}>terminal</span>
            </div>
            <pre className="font-mono overflow-x-auto p-5 text-xs leading-[1.8] sm:text-sm" style={{ color: MUTED }}>
              <span style={{ color: "#57534e" }}>$</span> <span style={{ color: DARK_T }}>git push origin main</span>{"\n\n"}
              <span style={{ color: TT }}>{"==>"}</span> <span style={{ color: DARK_T }}>Detected push to main</span>{"\n"}
              <span style={{ color: TT }}>{"==>"}</span>{" Building api (node:20-alpine)...\n"}
              <span style={{ color: TT }}>{"==>"}</span>{" Building web (./apps/web)...\n"}
              <span style={{ color: G }}>{"==>"}</span> <span style={{ color: G }}>Build complete</span>{" (14s)\n"}
              <span style={{ color: TT }}>{"==>"}</span>{" Running health checks...\n"}
              <span style={{ color: G }}>{"==>"}</span> <span style={{ color: G }}>All services healthy</span>{"\n"}
              <span style={{ color: G }}>{"==>"}</span> <span style={{ color: G }}>Deployed to production</span>{" (18s)\n\n"}
              <span style={{ color: TT_L }}>https://my-app.otterdeploy.sh</span>
            </pre>
          </div>
        </SlideIn>

        {/* Right: text */}
        <SlideIn direction="right">
          <span className="font-mono mb-4 inline-block text-xs font-medium uppercase tracking-wider" style={{ color: TEAL }}>GIT INTEGRATION</span>
          <h2 className="mb-4 text-3xl font-bold tracking-tight">Push to deploy. That's it.</h2>
          <p className="mb-6 text-sm leading-relaxed" style={{ color: TEXT2 }}>
            Every push triggers a build, runs health checks, and deploys to the right environment. Branch previews, automatic rollbacks, and full deploy history are built in.
          </p>
          <ul className="space-y-3">
            {["Automatic builds on push", "Branch preview environments", "Zero-downtime rolling deploys", "Instant rollbacks"].map((b) => (
              <li key={b} className="flex items-center gap-3 text-sm"><Check size={16} style={{ color: TEAL }} />{b}</li>
            ))}
          </ul>
        </SlideIn>
      </div>
    </section>
  );
}

/* ---- split: dashboard mockup ---- */

function SplitDashboard() {
  const SvcBox = ({ icon: Icon, label, accent }: { icon: React.ElementType; label: string; accent?: boolean }) => (
    <div className="flex items-center gap-2 rounded-lg border px-4 py-3"
      style={{ borderColor: accent ? TEAL : BORDER, background: accent ? "rgba(13,148,136,0.05)" : "transparent" }}>
      <Icon size={14} style={{ color: accent ? TEAL : MUTED }} />
      <span className="text-xs font-semibold" style={{ color: accent ? TEAL_D : TEXT2 }}>{label}</span>
      <span className="ml-auto h-2 w-2 rounded-full" style={{ background: G }} />
    </div>
  );

  return (
    <section className="px-6 py-24" style={{ borderBottom: `1px solid ${BORDER}` }}>
      <div className="mx-auto grid max-w-6xl items-center gap-16 lg:grid-cols-2">
        <SlideIn direction="left">
          <span className="font-mono mb-4 inline-block text-xs font-medium uppercase tracking-wider" style={{ color: TEAL }}>DASHBOARD</span>
          <h2 className="mb-4 text-3xl font-bold tracking-tight">Full visibility, real time.</h2>
          <p className="mb-6 text-sm leading-relaxed" style={{ color: TEXT2 }}>
            Monitor every service, database, and worker from a single dashboard. Streaming logs, resource metrics, and deploy history at your fingertips.
          </p>
          <ul className="space-y-3">
            {["Live log streaming", "Resource usage metrics", "Service dependency graph", "Deploy history timeline"].map((b) => (
              <li key={b} className="flex items-center gap-3 text-sm"><Check size={16} style={{ color: TEAL }} />{b}</li>
            ))}
          </ul>
        </SlideIn>

        <SlideIn direction="right" delay={0.15}>
          <div className="overflow-hidden rounded-xl border p-6" style={{ borderColor: BORDER, background: "#fff" }}>
            <div className="mb-5 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: MUTED }}>Architecture</span>
              <span className="inline-flex items-center gap-1.5 text-xs font-medium" style={{ color: G }}>
                <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: G }} />all healthy
              </span>
            </div>
            <div className="flex flex-col items-center gap-3">
              <div className="w-full max-w-[200px]"><SvcBox icon={Server} label="Web App" accent /></div>
              <div className="h-4 w-px" style={{ background: BORDER }} />
              <div className="w-full max-w-[200px]"><SvcBox icon={Server} label="API" accent /></div>
              <div className="h-4 w-px" style={{ background: BORDER }} />
              <div className="grid w-full max-w-[320px] grid-cols-2 gap-3">
                <SvcBox icon={Database} label="PostgreSQL" />
                <SvcBox icon={HardDrive} label="Redis" />
              </div>
            </div>
          </div>
        </SlideIn>
      </div>
    </section>
  );
}

/* ---- stats strip ---- */

function StatsStrip() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-40px" });
  const stats = [
    { v: "4,200+", l: "Total deploys" },
    { v: "99.9%", l: "Uptime SLA" },
    { v: "18s", l: "Avg build time" },
    { v: "6", l: "Resource types" },
  ];

  return (
    <section ref={ref} style={{ borderTop: `1px solid ${BORDER}`, borderBottom: `1px solid ${BORDER}` }}>
      <motion.div initial={{ opacity: 0 }} animate={inView ? { opacity: 1 } : {}} transition={{ duration: 0.6 }}
        className="mx-auto grid max-w-6xl grid-cols-2 md:grid-cols-4">
        {stats.map((s, i) => (
          <div key={s.l} className="px-6 py-14 text-center" style={{ borderRight: i < 3 ? `1px solid ${BORDER}` : "none" }}>
            <p className="mb-2 text-4xl font-bold">{s.v}</p>
            <p className="text-sm" style={{ color: TEXT2 }}>{s.l}</p>
          </div>
        ))}
      </motion.div>
    </section>
  );
}

/* ---- built for teams ---- */

function BuiltForTeams() {
  return (
    <section className="px-6 py-24">
      <div className="mx-auto grid max-w-6xl grid-cols-1 lg:grid-cols-2" style={{ borderTop: `1px solid ${BORDER}` }}>
        <SlideIn direction="left">
          <div className="py-12 pr-12" style={{ borderRight: `1px solid ${BORDER}` }}>
            <h2 className="mb-4 text-3xl font-bold tracking-tight">Focus on building</h2>
            <p className="mb-6 text-sm leading-relaxed" style={{ color: TEXT2 }}>
              Otterdeploy handles the infrastructure so your team can focus on shipping features. No more wrangling YAML, debugging Docker networking, or writing custom deploy scripts.
            </p>
            <ul className="space-y-3">
              {["Automated SSL certificates", "Built-in load balancing", "Zero-downtime deploys", "Automatic database backups"].map((b) => (
                <li key={b} className="flex items-center gap-3 text-sm">
                  <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: TEAL }} />{b}
                </li>
              ))}
            </ul>
          </div>
        </SlideIn>

        <SlideIn direction="right">
          <div className="py-12 pl-12">
            <h2 className="mb-4 text-3xl font-bold tracking-tight">Enterprise-ready security</h2>
            <p className="mb-6 text-sm leading-relaxed" style={{ color: TEXT2 }}>
              From startups to large organizations, Otterdeploy provides the security and compliance features your team needs.
            </p>
            <ul className="space-y-3">
              {[
                { i: Users, t: "Role-based access control" },
                { i: Lock, t: "Encrypted secrets at rest" },
                { i: ScrollText, t: "Audit logging" },
                { i: Shield, t: "SOC2-ready architecture" },
              ].map((b) => (
                <li key={b.t} className="flex items-center gap-3 text-sm">
                  <b.i size={16} style={{ color: TEAL }} />{b.t}
                </li>
              ))}
            </ul>
          </div>
        </SlideIn>
      </div>
    </section>
  );
}

/* ---- pricing (viteplus grid style) ---- */

function PricingSection() {
  return (
    <section id="pricing" className="px-6 py-24">
      <div className="mx-auto grid max-w-4xl grid-cols-1 overflow-hidden rounded-2xl md:grid-cols-2" style={{ border: `1px solid ${BORDER}` }}>
        <FadeUp>
          <div className="flex flex-col justify-center p-10" style={{ borderRight: `1px solid ${BORDER}`, borderBottom: `1px solid ${BORDER}` }}>
            <h2 className="mb-2 text-3xl font-bold tracking-tight">Pricing</h2>
            <p className="text-sm" style={{ color: TEXT2 }}>Free forever for open source</p>
          </div>
        </FadeUp>
        <FadeUp delay={0.1}>
          <div className="p-10" style={{ borderBottom: `1px solid ${BORDER}` }}>
            <span className="font-mono mb-3 inline-block text-xs font-medium uppercase tracking-wider" style={{ color: TEAL }}>Community</span>
            <p className="text-4xl font-bold">Free</p>
            <p className="mt-1 text-sm" style={{ color: TEXT2 }}>Unlimited projects, community support</p>
          </div>
        </FadeUp>
        <FadeUp delay={0.15}>
          <div className="p-10" style={{ borderRight: `1px solid ${BORDER}` }}>
            <span className="font-mono mb-3 inline-block text-xs font-medium uppercase tracking-wider" style={{ color: TEAL }}>Team</span>
            <p className="text-4xl font-bold">$49<span className="text-lg font-medium" style={{ color: TEXT2 }}>/mo</span></p>
            <p className="mt-1 text-sm" style={{ color: TEXT2 }}>RBAC, priority support, SLA</p>
          </div>
        </FadeUp>
        <FadeUp delay={0.2}>
          <div className="p-10">
            <span className="font-mono mb-3 inline-block text-xs font-medium uppercase tracking-wider" style={{ color: TEAL }}>Enterprise</span>
            <p className="text-4xl font-bold">Custom</p>
            <p className="mt-1 text-sm" style={{ color: TEXT2 }}>Dedicated support, custom integrations</p>
          </div>
        </FadeUp>
      </div>
    </section>
  );
}

/* ---- CTA (dark with teal aurora) ---- */

function CTASection() {
  return (
    <section id="cta" className="relative px-6 py-28" style={{
      background: `radial-gradient(ellipse at 50% 40%, rgba(13,148,136,0.25) 0%, transparent 60%),
                   radial-gradient(ellipse at 70% 80%, rgba(20,184,166,0.12) 0%, transparent 50%), ${DARK}`,
    }}>
      <div className="relative z-10 mx-auto max-w-xl text-center">
        <FadeUp>
          <h2 className="mb-6 text-4xl font-bold tracking-tight" style={{ color: DARK_T }}>
            Ready to simplify your deploys?
          </h2>
        </FadeUp>
        <FadeUp delay={0.1}>
          <div className="font-mono mx-auto mb-8 max-w-md rounded-lg px-5 py-3.5 text-sm"
            style={{ background: "rgba(13,148,136,0.15)", color: TT_L, border: "1px solid rgba(13,148,136,0.3)" }}>
            curl -fsSL https://get.otterdeploy.sh | sh
          </div>
        </FadeUp>
        <FadeUp delay={0.2}>
          <div className="flex flex-wrap items-center justify-center gap-4">
            <a href="#" className="inline-flex items-center gap-2 rounded-lg px-6 py-3 text-sm font-semibold transition-opacity hover:opacity-90"
              style={{ background: "#fff", color: DARK }}>
              Get Started <ArrowRight size={16} />
            </a>
            <a href="#" className="inline-flex items-center gap-2 rounded-lg border px-6 py-3 text-sm font-medium"
              style={{ borderColor: "rgba(250,250,249,0.25)", color: DARK_T }}>
              <BookOpen size={16} /> Read Docs
            </a>
          </div>
        </FadeUp>
      </div>
    </section>
  );
}

/* ---- footer ---- */

function Footer() {
  return (
    <footer className="px-6 py-14" style={{ background: DARK }}>
      <div className="mx-auto max-w-5xl">
        <div className="mb-10 grid gap-10 sm:grid-cols-4">
          <div>
            <p className="mb-3 text-base font-bold tracking-tight" style={{ color: DARK_T }}>otterdeploy</p>
            <p className="text-xs leading-relaxed" style={{ color: "#57534e" }}>
              Open-source, self-hosted PaaS for teams who ship fast and stay in control.
            </p>
          </div>
          {FOOTER_COLS.map((col) => (
            <div key={col.title}>
              <h4 className="mb-3 text-xs font-semibold tracking-wider" style={{ color: MUTED }}>{col.title}</h4>
              <ul className="space-y-2">
                {col.links.map((l) => (
                  <li key={l}>
                    <a href="#" className="text-xs transition-colors hover:text-stone-50" style={{ color: "#57534e" }}>{l}</a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="flex flex-col items-center justify-between gap-4 border-t pt-8 sm:flex-row" style={{ borderColor: "#292524" }}>
          <p className="text-xs" style={{ color: "#57534e" }}>&copy; 2026 Otterdeploy. All rights reserved.</p>
          <div className="flex items-center gap-4">
            <a href="#" className="transition-colors hover:text-stone-50" style={{ color: "#57534e" }}><Github size={16} /></a>
            <a href="#" className="transition-colors hover:text-stone-50" style={{ color: "#57534e" }}><Terminal size={16} /></a>
          </div>
        </div>
      </div>
    </footer>
  );
}
