import { motion, useInView } from "motion/react";
import { useRef } from "react";
import { ease } from "./fonts";
import { DEPLOY_LINES } from "./constants";
import { TerminalWindow, TerminalLine } from "./terminal";

export function AnimatedTerminalSection() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-60px" });

  return (
    <section
      ref={ref}
      className="relative z-10 py-28 px-5"
      style={{
        background:
          "radial-gradient(ellipse at 50% 0%, rgba(124,58,237,0.2) 0%, transparent 60%), radial-gradient(ellipse at 30% 50%, rgba(59,130,246,0.1) 0%, transparent 50%), #09090b",
      }}
    >
      <div className="max-w-3xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={ease}
        >
          <TerminalWindow title="terminal">
            <div className="text-sm leading-relaxed min-h-[320px]">
              {DEPLOY_LINES.map((line, i) => (
                <motion.div
                  key={i}
                  className="whitespace-pre"
                  initial={{ opacity: 0 }}
                  animate={inView ? { opacity: 1 } : {}}
                  transition={{
                    type: "tween",
                    ease: "easeOut",
                    delay: 0.08 * i,
                    duration: 0.4,
                  }}
                >
                  <TerminalLine line={line} />
                </motion.div>
              ))}
            </div>
          </TerminalWindow>
        </motion.div>
      </div>
    </section>
  );
}
