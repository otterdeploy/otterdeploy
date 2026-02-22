import { motion, useInView } from "motion/react";
import { useRef } from "react";
import { Quote } from "lucide-react";
import { font, ease } from "./fonts";
import { TESTIMONIALS } from "./constants";

export function TestimonialsSection() {
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
