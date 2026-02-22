import { motion, useInView } from "motion/react";
import { useRef } from "react";
import { Check } from "lucide-react";
import { font, ease } from "./fonts";

export function PricingGrid() {
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
