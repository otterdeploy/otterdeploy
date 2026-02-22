import { motion, useInView } from "motion/react";
import { useRef, useState } from "react";
import { ArrowRight, Copy, Check, Star } from "lucide-react";
import { font, ease } from "./fonts";
import { SATELLITE_NODES, GRID_CELLS } from "./constants";

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
                className="size-[76px] rounded-lg border border-white/[0.08] bg-[#18181b] flex items-center justify-center hover:border-[#7c3aed]/40 transition-colors"
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
          className="absolute inset-0 size-full pointer-events-none"
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

export function Hero() {
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
