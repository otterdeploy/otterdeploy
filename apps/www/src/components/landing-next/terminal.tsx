import { useEffect, useRef, useState } from "react";

import { Band, Container, cx, Mono } from "../landing/primitives";
import { TERMINAL } from "./content";
import { Reveal } from "./reveal";

/**
 * Ship from the terminal, typed out. Commands type character by character;
 * output lines drop in after. It plays once when scrolled into view, then
 * holds the finished session (a loop would re-type over a reader's shoulder).
 * `prefers-reduced-motion` renders the whole session at once.
 *
 * The commands and output are the real CLI's: `otterdeploy up --wait`, then
 * `logs`. State words are `deployment_status` members.
 */

const CHAR_MS = 26;
const LINE_GAP = 260;

export function TerminalDeploy() {
  const [visible, setVisible] = useState(0); // lines fully shown
  const [typed, setTyped] = useState(0); // chars typed of the current cmd line
  const ref = useRef<HTMLDivElement | null>(null);
  const started = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting || started.current) continue;
          started.current = true;
          io.disconnect();
          if (reduce) {
            setVisible(TERMINAL.length);
            return;
          }
          let li = 0;
          const run = () => {
            const line = TERMINAL[li];
            if (!line) return;
            if (line.t === "cmd") {
              let c = 0;
              const type = () => {
                c += 1;
                setTyped(c);
                if (c < line.text.length) setTimeout(type, CHAR_MS);
                else {
                  setVisible(li + 1);
                  setTyped(0);
                  li += 1;
                  setTimeout(run, LINE_GAP);
                }
              };
              type();
            } else {
              setVisible(li + 1);
              li += 1;
              setTimeout(run, LINE_GAP / 2);
            }
          };
          run();
        }
      },
      { threshold: 0.4 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const tone = { muted: "text-white/45", ok: "text-[#4ade80]", info: "text-[#7ab5ff]" };

  return (
    <Band id="cli">
      <Container className="grid items-center gap-12 py-20 lg:grid-cols-[0.9fr_1.1fr] lg:gap-16 lg:py-28">
        <Reveal>
          <Mono className="text-muted-foreground/70">FIG. 02 · CLI</Mono>
          <h2 className="mt-3 max-w-[16ch] text-[1.75rem] leading-[1.15] font-semibold tracking-[-0.02em] text-balance sm:text-[2.25rem]">
            Or ship it from your terminal
          </h2>
          <p className="mt-4 max-w-[46ch] text-[0.9375rem] leading-relaxed text-pretty text-muted-foreground">
            One manifest describes the project. The CLI reads it, applies the plan, and tails what
            happens next. 34 commands over the same typed API the dashboard uses. Device login for
            you, scoped tokens for CI.
          </p>
          <a
            href="/docs/cli/commands"
            className="mt-6 inline-block rounded-sm text-[0.875rem] font-medium text-foreground transition-colors duration-200 hover:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"
          >
            CLI reference ›
          </a>
        </Reveal>

        <Reveal delay={100}>
          <div
            ref={ref}
            className="overflow-hidden rounded-xl border border-white/[0.1] bg-[#0c0d0e] shadow-[0_24px_80px_-32px_rgba(0,0,0,0.9)]"
          >
            <div className="flex items-center gap-1.5 border-b border-white/[0.07] px-3.5 py-2.5">
              <span className="size-2 rounded-full bg-white/15" />
              <span className="size-2 rounded-full bg-white/15" />
              <span className="size-2 rounded-full bg-white/15" />
              <Mono className="ml-2 text-white/40">~/storefront · zsh</Mono>
            </div>
            <div className="min-h-[15rem] px-4 py-4 font-mono text-[0.8125rem] leading-[1.85]">
              {TERMINAL.map((line, i) => {
                if (i > visible) return null;
                const typing = i === visible && line.t === "cmd";
                const text = typing ? line.text.slice(0, typed) : line.text;
                if (
                  i === visible &&
                  line.t === "cmd" &&
                  typed === 0 &&
                  visible !== TERMINAL.length
                ) {
                  // current cmd not started typing yet
                }
                return line.t === "cmd" ? (
                  <div key={i} className={cx("whitespace-pre text-white/90", i > 0 && "mt-2.5")}>
                    <span aria-hidden className="mr-2 text-[#3d7bfb] select-none">
                      ❯
                    </span>
                    {text}
                    {typing ? (
                      <span className="ml-0.5 inline-block h-3.5 w-1.5 translate-y-0.5 bg-white/80 motion-safe:animate-pulse" />
                    ) : null}
                  </div>
                ) : (
                  <div key={i} className={cx("whitespace-pre pl-4", tone[line.tone ?? "muted"])}>
                    {text}
                  </div>
                );
              })}
            </div>
          </div>
        </Reveal>
      </Container>
    </Band>
  );
}
