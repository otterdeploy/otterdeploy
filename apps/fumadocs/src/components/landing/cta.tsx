"use client";

import { motion, useInView } from "motion/react";
import { useRef, useState } from "react";
import { ArrowRight, Copy, Check, Star } from "lucide-react";
import { font, ease } from "./fonts";

export function CTA() {
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
