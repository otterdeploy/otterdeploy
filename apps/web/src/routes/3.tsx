import { createFileRoute, Link } from "@tanstack/react-router";
import { motion, useInView } from "motion/react";
import {
  FileCode2,
  GitBranch,
  Layers,
  LayoutDashboard,
  ShieldCheck,
  Lock,
  Terminal,
  ArrowRight,
  Star,
  Github,
  ExternalLink,
} from "lucide-react";
import { useEffect, useRef } from "react";

export const Route = createFileRoute("/3")({
  component: RouteComponent,
});

/* ---------- constants ---------- */
const NAV_LINKS = ["Features", "Architecture", "Deploy", "Open Source"];
const VARIANT_ROUTES = ["/1", "/2", "/3", "/4", "/5"] as const;

const FEATURES = [
  { icon: FileCode2, title: "Declarative Config", desc: "Define your entire infrastructure in YAML. Services, databases, domains, scaling rules — all version-controlled and reproducible." },
  { icon: GitBranch, title: "Git-Driven Deploys", desc: "Push to deploy. Every branch gets a preview environment. Merge to main and production updates with zero-downtime rollouts." },
  { icon: Layers, title: "Multi-Environment", desc: "Staging, preview, production — spin up isolated environments with one command. Full parity across every realm." },
  { icon: LayoutDashboard, title: "Real-Time Dashboard", desc: "Monitor resources, stream logs, track deployments, and visualize your stack topology in a unified live interface." },
  { icon: Lock, title: "Secrets Management", desc: "Encrypted at rest and in transit. Automatic rotation, per-environment scoping, and full audit trails built in." },
  { icon: ShieldCheck, title: "Multi-Tenant RBAC", desc: "Granular role-based access across teams and projects. SSO federation, session management, and permission inheritance." },
];

const ARCH_NODES = [
  { label: "Frontend", x: "12%", y: "30%" },
  { label: "API Server", x: "42%", y: "18%" },
  { label: "Database", x: "72%", y: "35%" },
  { label: "Cache", x: "55%", y: "65%" },
];

const DEPLOY_STEPS = [
  {
    num: "01",
    title: "Define",
    desc: "Write a declarative config file describing your services, dependencies, and scaling rules.",
    code: `# otterdeploy.yml\nproject:\n  name: "my-app"\n  runtime: "node:22"\n  replicas: 3`,
  },
  {
    num: "02",
    title: "Push",
    desc: "Commit and push to your repository. Otterdeploy picks up the change and starts building.",
    code: `$ git add .\n$ git commit -m "feat: add caching layer"\n$ git push origin main\n\n→ Otterdeploy build triggered...`,
  },
  {
    num: "03",
    title: "Live",
    desc: "Your infrastructure is provisioned and live in under 30 seconds. Zero-downtime, every time.",
    code: `✓ Build complete (14s)\n✓ Health checks passed\n✓ Traffic shifted to v2.4.1\n\nhttps://my-app.otterdeploy.sh`,
  },
];

/* ---------- reusable glass card classes ---------- */
const GLASS = "backdrop-blur-xl bg-white/[0.03] border border-white/[0.06]";
const GLASS_HOVER = "hover:border-violet-500/30 hover:bg-white/[0.05] transition-all duration-300";

/* ---------- Main Component ---------- */
function RouteComponent() {
  useEffect(() => {
    const id = "violet-aurora-fonts";
    if (document.getElementById(id)) return;
    const link = document.createElement("link");
    link.id = id;
    link.rel = "stylesheet";
    link.href =
      "https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800&family=Fira+Code:wght@400&display=swap";
    document.head.appendChild(link);
  }, []);

  const featRef = useRef<HTMLDivElement>(null);
  const featInView = useInView(featRef, { once: true, margin: "-100px" });
  const archRef = useRef<HTMLDivElement>(null);
  const archInView = useInView(archRef, { once: true, margin: "-80px" });
  const deployRef = useRef<HTMLDivElement>(null);
  const deployInView = useInView(deployRef, { once: true, margin: "-80px" });
  const codeRef = useRef<HTMLDivElement>(null);
  const codeInView = useInView(codeRef, { once: true, margin: "-80px" });

  return (
    <div
      className="relative min-h-screen overflow-x-hidden"
      style={{ background: "#09090b", color: "#fafafa", fontFamily: "'Outfit', sans-serif" }}
    >
      {/* ---- keyframes for gradient blob drift ---- */}
      <style>{`
        @keyframes blobDrift1 {
          0%, 100% { transform: translate(0, 0) scale(1); }
          33% { transform: translate(40px, -30px) scale(1.05); }
          66% { transform: translate(-20px, 20px) scale(0.95); }
        }
        @keyframes blobDrift2 {
          0%, 100% { transform: translate(0, 0) scale(1); }
          50% { transform: translate(-50px, 30px) scale(1.08); }
        }
        @keyframes blobDrift3 {
          0%, 100% { transform: translate(0, 0) scale(1); }
          40% { transform: translate(30px, 40px) scale(0.96); }
          80% { transform: translate(-40px, -20px) scale(1.04); }
        }
      `}</style>

      {/* ========== NAVIGATION ========== */}
      <nav
        className={`fixed top-0 left-0 right-0 z-50 ${GLASS} border-t-0 border-x-0`}
        style={{ borderBottom: "1px solid rgba(139, 92, 246, 0.12)" }}
      >
        <div className="max-w-7xl mx-auto flex items-center justify-between px-6 py-3">
          <Link to="/" className="flex items-center gap-1.5 text-lg font-semibold tracking-tight">
            <span className="w-2 h-2 rounded-full bg-violet-500 inline-block" />
            <span>otterdeploy</span>
          </Link>

          <div className="hidden md:flex items-center gap-8 text-sm text-zinc-400 font-light">
            {NAV_LINKS.map((l) => (
              <a key={l} href={`#${l.toLowerCase().replace(" ", "-")}`} className="hover:text-white transition-colors">
                {l}
              </a>
            ))}
          </div>

          <div className="flex items-center gap-3">
            <div className="hidden sm:flex items-center gap-1 text-xs">
              {VARIANT_ROUTES.map((r, i) => (
                <Link
                  key={r}
                  to={r}
                  className={`w-7 h-7 flex items-center justify-center rounded-md transition-colors text-xs ${
                    r === "/3"
                      ? "bg-violet-500/20 text-violet-400 border border-violet-500/30"
                      : "text-zinc-500 hover:text-zinc-300 hover:bg-white/[0.04]"
                  }`}
                >
                  {i + 1}
                </Link>
              ))}
            </div>
            <button className="px-4 py-1.5 text-sm font-medium rounded-lg bg-gradient-to-r from-violet-600 via-purple-500 to-pink-500 text-white hover:opacity-90 transition-opacity">
              Start Free
            </button>
          </div>
        </div>
      </nav>

      {/* ========== HERO ========== */}
      <section className="relative flex flex-col items-center justify-center min-h-screen pt-24 pb-20 px-4 overflow-hidden">
        {/* Aurora gradient blobs */}
        <div
          className="absolute top-[-10%] left-[-10%] w-[600px] h-[600px] rounded-full opacity-[0.15]"
          style={{
            background: "radial-gradient(circle, #7c3aed 0%, #a855f7 40%, transparent 70%)",
            filter: "blur(120px)",
            animation: "blobDrift1 18s ease-in-out infinite",
          }}
        />
        <div
          className="absolute top-[10%] right-[-5%] w-[500px] h-[500px] rounded-full opacity-[0.10]"
          style={{
            background: "radial-gradient(circle, #a855f7 0%, #ec4899 40%, transparent 70%)",
            filter: "blur(100px)",
            animation: "blobDrift2 20s ease-in-out infinite",
          }}
        />
        <div
          className="absolute bottom-[-5%] left-[25%] w-[700px] h-[500px] rounded-full opacity-[0.08]"
          style={{
            background: "radial-gradient(circle, #3b82f6 0%, #7c3aed 40%, transparent 70%)",
            filter: "blur(140px)",
            animation: "blobDrift3 16s ease-in-out infinite",
          }}
        />

        <div className="relative z-10 text-center max-w-4xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className={`inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-sm mb-8 ${GLASS}`}
          >
            <span className="text-violet-400">&#10022;</span>
            <span className="text-zinc-300 font-light">Open Source Infrastructure</span>
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.15 }}
            className="text-5xl sm:text-6xl lg:text-8xl font-bold leading-[1.05] tracking-tight"
          >
            Infrastructure{"\n"}
            <span className="bg-gradient-to-r from-violet-500 via-purple-500 to-pink-500 bg-clip-text text-transparent">
              that scales with you
            </span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.3 }}
            className="mt-6 text-lg md:text-xl max-w-2xl mx-auto text-zinc-400 font-light leading-relaxed"
          >
            Otterdeploy is a self-hosted PaaS that turns declarative configs into running infrastructure.
            Define once, deploy everywhere.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.45 }}
            className="flex flex-wrap justify-center gap-4 mt-10"
          >
            <button className="px-7 py-3 text-sm font-medium rounded-lg bg-gradient-to-r from-violet-600 via-purple-500 to-pink-500 text-white hover:opacity-90 transition-opacity flex items-center gap-2">
              Deploy Now <ArrowRight size={16} />
            </button>
            <button className={`px-7 py-3 text-sm font-medium rounded-lg ${GLASS} ${GLASS_HOVER} flex items-center gap-2 text-zinc-300`}>
              <Star size={16} /> Star on GitHub
            </button>
          </motion.div>

          {/* Stats row */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.6 }}
            className="flex flex-wrap justify-center gap-4 mt-16"
          >
            {["4,200+ Deploys", "99.9% Uptime", "<30s Builds"].map((stat) => (
              <div
                key={stat}
                className={`px-6 py-3 rounded-xl text-sm ${GLASS}`}
              >
                <span className="text-white font-semibold">{stat.split(" ")[0]}</span>{" "}
                <span className="text-zinc-400 font-light">{stat.split(" ").slice(1).join(" ")}</span>
              </div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* ========== FEATURES ========== */}
      <section id="features" className="relative py-28 px-4">
        {/* Subtle blob behind grid */}
        <div
          className="absolute top-[20%] left-[30%] w-[500px] h-[400px] rounded-full opacity-[0.06]"
          style={{ background: "radial-gradient(circle, #8b5cf6, transparent 70%)", filter: "blur(100px)" }}
        />

        <div className="max-w-6xl mx-auto relative z-10">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
            className="text-center mb-16"
          >
            <h2 className="text-3xl md:text-4xl font-bold mb-4">Built for modern teams</h2>
            <p className="text-zinc-400 font-light text-lg max-w-xl mx-auto">
              Everything you need to go from commit to production
            </p>
          </motion.div>

          <div ref={featRef} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {FEATURES.map((f, i) => {
              const Icon = f.icon;
              return (
                <motion.div
                  key={f.title}
                  initial={{ opacity: 0, y: 20, scale: 0.98 }}
                  animate={featInView ? { opacity: 1, y: 0, scale: 1 } : {}}
                  transition={{ duration: 0.6, delay: i * 0.1 }}
                  className={`p-6 rounded-2xl ${GLASS} ${GLASS_HOVER} group cursor-default`}
                >
                  <div className="w-10 h-10 rounded-xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-center mb-4 group-hover:bg-violet-500/15 transition-colors">
                    <Icon size={20} className="text-violet-400" />
                  </div>
                  <h3 className="text-lg font-semibold mb-2">{f.title}</h3>
                  <p className="text-sm text-zinc-400 font-light leading-relaxed">{f.desc}</p>
                </motion.div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ========== ARCHITECTURE ========== */}
      <section id="architecture" className="relative py-28 px-4 overflow-hidden">
        <div className="max-w-6xl mx-auto">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            {/* Diagram */}
            <div ref={archRef} className={`relative rounded-2xl p-8 aspect-[4/3] ${GLASS}`}>
              {/* connection lines as SVG */}
              <svg className="absolute inset-0 w-full h-full" viewBox="0 0 400 300" fill="none" preserveAspectRatio="xMidYMid meet">
                <defs>
                  <linearGradient id="lineGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#8b5cf6" stopOpacity="0.6" />
                    <stop offset="100%" stopColor="#a855f7" stopOpacity="0.3" />
                  </linearGradient>
                </defs>
                <motion.line
                  x1="68" y1="100" x2="188" y2="70"
                  stroke="url(#lineGrad)" strokeWidth="1.5"
                  initial={{ pathLength: 0, opacity: 0 }}
                  animate={archInView ? { pathLength: 1, opacity: 1 } : {}}
                  transition={{ duration: 0.8, delay: 0.3 }}
                />
                <motion.line
                  x1="188" y1="70" x2="308" y2="115"
                  stroke="url(#lineGrad)" strokeWidth="1.5"
                  initial={{ pathLength: 0, opacity: 0 }}
                  animate={archInView ? { pathLength: 1, opacity: 1 } : {}}
                  transition={{ duration: 0.8, delay: 0.5 }}
                />
                <motion.line
                  x1="308" y1="115" x2="240" y2="205"
                  stroke="url(#lineGrad)" strokeWidth="1.5"
                  initial={{ pathLength: 0, opacity: 0 }}
                  animate={archInView ? { pathLength: 1, opacity: 1 } : {}}
                  transition={{ duration: 0.8, delay: 0.7 }}
                />
                <motion.line
                  x1="240" y1="205" x2="68" y2="100"
                  stroke="url(#lineGrad)" strokeWidth="1.5"
                  initial={{ pathLength: 0, opacity: 0 }}
                  animate={archInView ? { pathLength: 1, opacity: 1 } : {}}
                  transition={{ duration: 0.8, delay: 0.9 }}
                />
              </svg>

              {/* Nodes */}
              {ARCH_NODES.map((node, i) => (
                <motion.div
                  key={node.label}
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={archInView ? { opacity: 1, scale: 1 } : {}}
                  transition={{ duration: 0.5, delay: 0.2 + i * 0.15 }}
                  className={`absolute ${GLASS} rounded-xl px-4 py-3 flex items-center gap-2`}
                  style={{ left: node.x, top: node.y }}
                >
                  <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_6px_#34d399]" />
                  <span className="text-sm font-medium">{node.label}</span>
                </motion.div>
              ))}
            </div>

            {/* Text */}
            <motion.div
              initial={{ opacity: 0, x: 30 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.7 }}
            >
              <h2 className="text-3xl md:text-4xl font-bold mb-4">Visualize your entire stack</h2>
              <p className="text-zinc-400 font-light leading-relaxed mb-6">
                The real-time architecture view maps every service, database, and cache in your infrastructure.
                Watch connections light up as traffic flows, spot bottlenecks instantly, and understand your
                system topology at a glance.
              </p>
              <p className="text-zinc-500 font-light leading-relaxed">
                Every node shows live health status, resource utilization, and deployment version.
                Click any node to drill into logs, metrics, and configuration details.
              </p>
            </motion.div>
          </div>
        </div>
      </section>

      {/* ========== DEPLOY FLOW ========== */}
      <section id="deploy" className="relative py-28 px-4">
        <div
          className="absolute top-[40%] right-[10%] w-[400px] h-[400px] rounded-full opacity-[0.06]"
          style={{ background: "radial-gradient(circle, #a855f7, transparent 70%)", filter: "blur(120px)" }}
        />

        <div className="max-w-4xl mx-auto relative z-10">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
            className="text-center mb-16"
          >
            <h2 className="text-3xl md:text-4xl font-bold mb-4">From code to production in minutes</h2>
          </motion.div>

          <div ref={deployRef} className="relative">
            {/* Connecting gradient line */}
            <div className="absolute left-6 md:left-8 top-0 bottom-0 w-px bg-gradient-to-b from-violet-600 via-purple-500 to-pink-500 opacity-30" />

            <div className="space-y-10">
              {DEPLOY_STEPS.map((step, i) => (
                <motion.div
                  key={step.num}
                  initial={{ opacity: 0, y: 30 }}
                  animate={deployInView ? { opacity: 1, y: 0 } : {}}
                  transition={{ duration: 0.6, delay: i * 0.2 }}
                  className="relative flex gap-6 md:gap-8"
                >
                  {/* Step number */}
                  <div className="relative z-10 flex-shrink-0 w-12 h-12 md:w-16 md:h-16 rounded-full bg-gradient-to-br from-violet-600 to-purple-600 flex items-center justify-center text-sm md:text-base font-bold shadow-[0_0_20px_rgba(139,92,246,0.3)]">
                    {step.num}
                  </div>

                  {/* Card */}
                  <div className={`flex-1 rounded-2xl p-6 ${GLASS} ${GLASS_HOVER}`}>
                    <h3 className="text-xl font-semibold mb-2">{step.title}</h3>
                    <p className="text-zinc-400 font-light text-sm mb-4">{step.desc}</p>
                    <pre
                      className="text-xs leading-relaxed p-4 rounded-xl bg-black/40 border border-white/[0.04] overflow-x-auto"
                      style={{ fontFamily: "'Fira Code', monospace" }}
                    >
                      <code className="text-violet-300/80">{step.code}</code>
                    </pre>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ========== CODE PREVIEW ========== */}
      <section className="relative py-28 px-4 overflow-hidden">
        <div className="max-w-3xl mx-auto">
          <motion.div
            ref={codeRef}
            initial={{ opacity: 0, y: 40 }}
            animate={codeInView ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: 0.7 }}
            className="relative"
          >
            {/* Glow behind terminal */}
            <div
              className="absolute -inset-8 rounded-3xl opacity-20"
              style={{ background: "radial-gradient(circle, #7c3aed 0%, transparent 70%)", filter: "blur(60px)" }}
            />

            <div className={`relative rounded-2xl overflow-hidden ${GLASS}`} style={{ borderColor: "rgba(139, 92, 246, 0.15)" }}>
              {/* Title bar */}
              <div className="flex items-center gap-3 px-5 py-3 border-b border-white/[0.06] bg-white/[0.02]">
                <div className="flex gap-1.5">
                  <span className="w-3 h-3 rounded-full bg-zinc-700" />
                  <span className="w-3 h-3 rounded-full bg-zinc-700" />
                  <span className="w-3 h-3 rounded-full bg-zinc-700" />
                </div>
                <span className="text-xs text-zinc-500 font-light" style={{ fontFamily: "'Fira Code', monospace" }}>
                  <Terminal size={12} className="inline mr-1.5" style={{ verticalAlign: "middle" }} />
                  otterdeploy.yml
                </span>
              </div>

              {/* Code body */}
              <pre
                className="p-6 text-sm leading-relaxed overflow-x-auto"
                style={{ fontFamily: "'Fira Code', monospace" }}
              >
                <code>
                  <span className="text-zinc-600"># otterdeploy.yml</span>{"\n"}
                  <span className="text-violet-400">project</span><span className="text-zinc-600">:</span>{"\n"}
                  {"  "}<span className="text-purple-400">name</span><span className="text-zinc-600">:</span> <span className="text-emerald-400">"my-saas-app"</span>{"\n"}
                  {"  "}<span className="text-purple-400">runtime</span><span className="text-zinc-600">:</span> <span className="text-emerald-400">"node:22-alpine"</span>{"\n"}
                  {"  "}<span className="text-purple-400">replicas</span><span className="text-zinc-600">:</span> <span className="text-amber-400">3</span>{"\n\n"}
                  <span className="text-violet-400">environments</span><span className="text-zinc-600">:</span>{"\n"}
                  {"  "}<span className="text-purple-400">production</span><span className="text-zinc-600">:</span>{"\n"}
                  {"    "}<span className="text-purple-400">domain</span><span className="text-zinc-600">:</span> <span className="text-emerald-400">"app.example.com"</span>{"\n"}
                  {"    "}<span className="text-purple-400">auto_scale</span><span className="text-zinc-600">:</span> <span className="text-amber-400">true</span>{"\n"}
                  {"    "}<span className="text-purple-400">min_instances</span><span className="text-zinc-600">:</span> <span className="text-amber-400">2</span>{"\n"}
                  {"    "}<span className="text-purple-400">max_instances</span><span className="text-zinc-600">:</span> <span className="text-amber-400">12</span>{"\n\n"}
                  <span className="text-violet-400">services</span><span className="text-zinc-600">:</span>{"\n"}
                  {"  "}<span className="text-purple-400">database</span><span className="text-zinc-600">:</span>{"\n"}
                  {"    "}<span className="text-purple-400">engine</span><span className="text-zinc-600">:</span> <span className="text-emerald-400">"postgres:16"</span>{"\n"}
                  {"    "}<span className="text-purple-400">storage</span><span className="text-zinc-600">:</span> <span className="text-emerald-400">"20Gi"</span>{"\n"}
                  {"  "}<span className="text-purple-400">cache</span><span className="text-zinc-600">:</span>{"\n"}
                  {"    "}<span className="text-purple-400">engine</span><span className="text-zinc-600">:</span> <span className="text-emerald-400">"redis:7"</span>{"\n\n"}
                  <span className="text-violet-400">secrets</span><span className="text-zinc-600">:</span>{"\n"}
                  {"  "}<span className="text-purple-400">vault</span><span className="text-zinc-600">:</span> <span className="text-emerald-400">"otterdeploy/my-saas"</span>{"\n"}
                  {"  "}<span className="text-purple-400">rotate</span><span className="text-zinc-600">:</span> <span className="text-emerald-400">"30d"</span>
                </code>
              </pre>
            </div>
          </motion.div>
        </div>
      </section>

      {/* ========== CTA ========== */}
      <section className="relative py-32 px-4 text-center overflow-hidden">
        {/* Central gradient blob */}
        <div
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[400px] rounded-full opacity-[0.10]"
          style={{ background: "radial-gradient(circle, #7c3aed 0%, #a855f7 30%, transparent 70%)", filter: "blur(100px)" }}
        />

        <div className="relative z-10 max-w-2xl mx-auto">
          <motion.h2
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
            className="text-4xl md:text-5xl font-bold mb-4 bg-gradient-to-r from-violet-500 via-purple-500 to-pink-500 bg-clip-text text-transparent"
          >
            Start deploying today
          </motion.h2>

          <motion.p
            initial={{ opacity: 0, y: 15 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6, delay: 0.1 }}
            className="text-zinc-400 font-light text-lg mb-10"
          >
            Free forever. Open source. Self-hosted.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 15 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="flex flex-wrap justify-center gap-4 mb-10"
          >
            <button className="px-8 py-3 text-sm font-medium rounded-lg bg-gradient-to-r from-violet-600 via-purple-500 to-pink-500 text-white hover:opacity-90 transition-opacity flex items-center gap-2">
              Get Started <ArrowRight size={16} />
            </button>
            <button className={`px-8 py-3 text-sm font-medium rounded-lg ${GLASS} ${GLASS_HOVER} flex items-center gap-2 text-zinc-300`}>
              <ExternalLink size={16} /> Read the Docs
            </button>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 15 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6, delay: 0.3 }}
            className={`inline-flex items-center gap-3 px-5 py-3 rounded-xl ${GLASS}`}
          >
            <Terminal size={14} className="text-zinc-500" />
            <code className="text-sm text-zinc-300 font-light" style={{ fontFamily: "'Fira Code', monospace" }}>
              curl -fsSL https://get.otterdeploy.sh | sh
            </code>
          </motion.div>
        </div>
      </section>

      {/* ========== FOOTER ========== */}
      <footer className="relative border-t border-white/[0.06] py-16 px-4">
        <div className="max-w-6xl mx-auto">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-10 mb-12">
            {/* Brand */}
            <div className="col-span-2 md:col-span-1">
              <div className="flex items-center gap-1.5 text-lg font-semibold mb-3">
                <span className="w-2 h-2 rounded-full bg-violet-500 inline-block" />
                <span>otterdeploy</span>
              </div>
              <p className="text-sm text-zinc-500 font-light">Built with care for developers who ship.</p>
            </div>

            {/* Product */}
            <div>
              <h4 className="text-sm font-medium mb-4 text-zinc-300">Product</h4>
              <ul className="space-y-2 text-sm text-zinc-500 font-light">
                <li><a href="#" className="hover:text-zinc-300 transition-colors">Features</a></li>
                <li><a href="#" className="hover:text-zinc-300 transition-colors">Pricing</a></li>
                <li><a href="#" className="hover:text-zinc-300 transition-colors">Changelog</a></li>
                <li><a href="#" className="hover:text-zinc-300 transition-colors">Roadmap</a></li>
              </ul>
            </div>

            {/* Developers */}
            <div>
              <h4 className="text-sm font-medium mb-4 text-zinc-300">Developers</h4>
              <ul className="space-y-2 text-sm text-zinc-500 font-light">
                <li><a href="#" className="hover:text-zinc-300 transition-colors">Documentation</a></li>
                <li><a href="#" className="hover:text-zinc-300 transition-colors">API Reference</a></li>
                <li><a href="#" className="hover:text-zinc-300 transition-colors">CLI Guide</a></li>
                <li><a href="#" className="hover:text-zinc-300 transition-colors">Examples</a></li>
              </ul>
            </div>

            {/* Community */}
            <div>
              <h4 className="text-sm font-medium mb-4 text-zinc-300">Community</h4>
              <ul className="space-y-2 text-sm text-zinc-500 font-light">
                <li><a href="#" className="hover:text-zinc-300 transition-colors flex items-center gap-1.5"><Github size={14} /> GitHub</a></li>
                <li><a href="#" className="hover:text-zinc-300 transition-colors">Discord</a></li>
                <li><a href="#" className="hover:text-zinc-300 transition-colors">Twitter</a></li>
                <li><a href="#" className="hover:text-zinc-300 transition-colors">Contributing</a></li>
              </ul>
            </div>
          </div>

          <div className="border-t border-white/[0.06] pt-6 flex flex-col md:flex-row items-center justify-between gap-3 text-xs text-zinc-600 font-light">
            <span>&copy; 2026 Otterdeploy. All rights reserved.</span>
            <span>Built with care</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
