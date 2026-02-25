"use client";

import { motion, useInView } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import { font, ease } from "./fonts";
import { FEATURE_TABS } from "./constants";
import { TerminalWindow, TerminalLine } from "./terminal";

function FeatureSection({
  tab,
  reverse,
}: {
  tab: (typeof FEATURE_TABS)[number];
  reverse?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });

  return (
    <div
      id={`feature-${tab.key}`}
      ref={ref}
      className="scroll-mt-28 py-20 px-5 border-b border-white/[0.06]"
    >
      <motion.div
        className={`max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-12 items-center ${
          reverse ? "lg:direction-rtl" : ""
        }`}
        initial={{ opacity: 0, y: 24 }}
        animate={inView ? { opacity: 1, y: 0 } : {}}
        transition={ease}
        style={{ direction: "ltr" }}
      >
        <div className={reverse ? "lg:order-2" : ""}>
          <div className="inline-flex items-center gap-2 mb-4 text-[#7c3aed]">
            {tab.icon}
            <span
              className="text-xs uppercase tracking-wider font-medium text-[#a78bfa]"
              style={font.mono}
            >
              {tab.label}
            </span>
          </div>
          <h3
            className="text-2xl md:text-3xl font-bold text-[#fafafa] mb-4"
            style={font.display}
          >
            {tab.heading}
          </h3>
          <p
            className="text-base text-[#a1a1aa] leading-relaxed mb-8"
            style={font.body}
          >
            {tab.desc}
          </p>
          <ul className="flex flex-col gap-3.5">
            {tab.bullets.map((b) => (
              <li key={b} className="flex items-start gap-3">
                <span className="mt-0.5 shrink-0">
                  <Check size={16} className="text-[#4ade80]" />
                </span>
                <span
                  className="text-sm text-[#a1a1aa] leading-relaxed"
                  style={font.body}
                >
                  {b}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className={reverse ? "lg:order-1" : ""}>
          <TerminalWindow title={tab.terminal.title}>
            <div className="text-xs leading-relaxed whitespace-pre min-h-[220px]">
              {tab.terminal.lines.map((line, i) => (
                <motion.div
                  key={`${tab.key}-${i}`}
                  initial={{ opacity: 0 }}
                  animate={inView ? { opacity: 1 } : {}}
                  transition={{
                    type: "tween",
                    ease: "easeOut",
                    delay: 0.2 + 0.05 * i,
                    duration: 0.3,
                  }}
                >
                  <TerminalLine line={line} />
                </motion.div>
              ))}
            </div>
          </TerminalWindow>
        </div>
      </motion.div>
    </div>
  );
}

export function FeatureTabs() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-60px" });
  const [activeKey, setActiveKey] = useState(FEATURE_TABS[0].key);

  const scrollTo = (key: string) => {
    setActiveKey(key);
    const el = document.getElementById(`feature-${key}`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const key = entry.target.id.replace("feature-", "");
            setActiveKey(key);
          }
        }
      },
      { rootMargin: "-40% 0px -50% 0px" }
    );

    for (const tab of FEATURE_TABS) {
      const el = document.getElementById(`feature-${tab.key}`);
      if (el) observer.observe(el);
    }

    return () => observer.disconnect();
  }, []);

  return (
    <section
      id="features"
      ref={ref}
      className="relative z-10"
      style={{
        background:
          "radial-gradient(ellipse at 50% 0%, rgba(124,58,237,0.1) 0%, transparent 50%), radial-gradient(ellipse at 80% 100%, rgba(59,130,246,0.06) 0%, transparent 40%), #0c0c0f",
      }}
    >
      <div className="pt-28 pb-20 px-5">
        <motion.div
          className="text-center"
          initial={{ opacity: 0, y: 15 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={ease}
        >
          <h2
            className="text-4xl md:text-5xl font-bold text-[#fafafa] tracking-tight"
            style={font.display}
          >
            Everything you need in one tool
          </h2>
          <p
            className="mt-4 text-base text-[#71717a] max-w-2xl mx-auto leading-relaxed"
            style={font.body}
          >
            Otterdeploy unifies your entire deployment workflow into
            a single, powerful command-line interface.
          </p>
        </motion.div>
      </div>

      <div className="sticky top-12 z-40 bg-[#0c0c0f]/90 backdrop-blur-lg border-t border-b border-white/[0.08] overflow-x-auto">
        <div className="max-w-6xl mx-auto flex">
          {FEATURE_TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => scrollTo(tab.key)}
              className={`flex items-center justify-center gap-2.5 px-6 py-4 text-sm whitespace-nowrap border-b-2 transition-colors flex-1 min-w-0 ${
                activeKey === tab.key
                  ? "border-[#7c3aed] text-[#fafafa] bg-white/[0.02]"
                  : "border-transparent text-[#71717a] hover:text-[#a1a1aa] hover:bg-white/[0.02]"
              }`}
              style={{ ...font.mono, fontWeight: 500 }}
            >
              {tab.icon}
              <span className="hidden sm:inline">{tab.label}</span>
            </button>
          ))}
        </div>
      </div>

      {FEATURE_TABS.map((tab, i) => (
        <FeatureSection key={tab.key} tab={tab} reverse={i % 2 === 1} />
      ))}
    </section>
  );
}
