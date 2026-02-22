"use client";

import { motion, useInView } from "motion/react";
import { useRef } from "react";
import { Server, Heart, Check } from "lucide-react";
import { font, ease } from "./fonts";

export function TwoColumns() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });

  const selfHostBullets = [
    "Data sovereignty \u2014 your servers, your data, your rules",
    "No surprise bills or usage-based pricing",
    "Compliance-ready for regulated industries (GDPR, HIPAA, SOC 2)",
    "Full customization and extensibility via plugins",
    "Unlimited resources \u2014 scale to your hardware, not a pricing tier",
    "Run on any cloud, VPS, or bare metal server",
  ];

  const openSourceBullets = [
    "MIT licensed \u2014 use it anywhere, for anything",
    "Transparent development on GitHub",
    "Community-driven roadmap and priorities",
    "42+ contributors and growing fast",
    "Regular releases with full changelogs",
    "No vendor lock-in, ever",
  ];

  return (
    <section
      ref={ref}
      className="relative z-10 py-24 px-5 border-t border-white/[0.08]"
      style={{ background: "#111113" }}
    >
      <div className="max-w-5xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-16">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ ...ease, delay: 0.05 }}
        >
          <div className="flex items-center gap-2 mb-6">
            <Server size={20} className="text-[#7c3aed]" />
            <h3
              className="text-2xl font-bold text-[#fafafa]"
              style={font.display}
            >
              Why self-host?
            </h3>
          </div>
          <ul className="flex flex-col gap-3">
            {selfHostBullets.map((b) => (
              <li key={b} className="flex items-start gap-3">
                <span className="size-1.5 rounded-full bg-[#7c3aed] mt-2 shrink-0" />
                <span
                  className="text-sm text-[#a1a1aa] leading-relaxed"
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
          <div className="flex items-center gap-2 mb-6">
            <Heart size={20} className="text-[#7c3aed]" />
            <h3
              className="text-2xl font-bold text-[#fafafa]"
              style={font.display}
            >
              Open source, always
            </h3>
          </div>
          <ul className="flex flex-col gap-3">
            {openSourceBullets.map((b) => (
              <li key={b} className="flex items-start gap-3">
                <Check
                  size={16}
                  className="text-[#7c3aed] mt-0.5 shrink-0"
                />
                <span
                  className="text-sm text-[#a1a1aa] leading-relaxed"
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
