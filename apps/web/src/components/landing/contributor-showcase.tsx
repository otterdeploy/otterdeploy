import { motion, useInView } from "motion/react";
import { useRef } from "react";
import { ArrowRight } from "lucide-react";
import { font, ease } from "./fonts";
import { CONTRIBUTOR_AVATARS } from "./constants";

export function ContributorShowcase() {
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

        <motion.div
          className="flex flex-wrap justify-center gap-3 mb-8"
          initial={{ opacity: 0 }}
          animate={inView ? { opacity: 1 } : {}}
          transition={{ ...ease, delay: 0.1 }}
        >
          {CONTRIBUTOR_AVATARS.map((c, i) => (
            <motion.div
              key={i}
              className="size-12 rounded-full border border-white/[0.08] flex items-center justify-center hover:border-[#7c3aed]/40 transition-colors"
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
