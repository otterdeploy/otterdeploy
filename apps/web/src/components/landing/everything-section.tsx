import { motion, useInView } from "motion/react";
import { useRef } from "react";
import { font, ease } from "./fonts";

export function EverythingSection() {
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
