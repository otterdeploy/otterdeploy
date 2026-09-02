import { useEffect, useRef, useState } from "react";

import { Band, Container, cx, Mono } from "../landing/primitives";
import { PIPELINE_PHASES } from "./content";
import { Reveal } from "./reveal";

/**
 * A live deploy, animated. The stations light up left to right in the app's
 * own vocabulary — pending → building → image → rollout → route → tls →
 * running — with a comet travelling the rail, a progress bar filling, the
 * active phase's detail streaming, and the status pill turning amber then
 * green. It loops. `prefers-reduced-motion` paints the finished deploy and
 * holds it.
 *
 * Not a screenshot and not a spinner: it depicts the one thing on this page
 * that genuinely moves, because a deploy moves.
 */

const TOTAL = PIPELINE_PHASES.length;

function useDeployClock() {
  const [step, setStep] = useState(TOTAL - 1); // SSR paints the finished rail
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let i = 0;
    const tick = () => {
      setStep(i);
      const phase = PIPELINE_PHASES[i];
      i = (i + 1) % TOTAL;
      // A beat of black between loops so the restart reads as a new deploy.
      const wait = i === 0 ? phase.ms + 900 : phase.ms;
      timer.current = setTimeout(tick, wait);
    };
    // Rewind to the start after first paint, never during it.
    const frame = requestAnimationFrame(() => {
      setStep(0);
      tick();
    });
    return () => {
      cancelAnimationFrame(frame);
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  return step;
}

export function DeployPipeline() {
  const step = useDeployClock();
  const active = PIPELINE_PHASES[step];
  const running = active.key === "running";
  const progress = (step / (TOTAL - 1)) * 100;

  return (
    <Band>
      <Container className="py-20 lg:py-28">
        <Reveal className="mx-auto max-w-[40rem] text-center">
          <Mono className="text-muted-foreground/70">LIVE · ONE DEPLOY</Mono>
          <h2 className="mt-3 text-[1.75rem] leading-[1.15] font-semibold tracking-[-0.02em] text-balance sm:text-[2.25rem]">
            Push to git. Watch it reach production.
          </h2>
          <p className="mx-auto mt-4 max-w-[46ch] text-[0.9375rem] leading-relaxed text-pretty text-muted-foreground">
            Railpack builds the repo, the image rolls out on Swarm, Caddy takes the domain and
            issues the certificate — every phase named and honest about where it is.
          </p>
        </Reveal>

        <Reveal delay={120}>
          <div className="mx-auto mt-12 max-w-[62rem] overflow-hidden rounded-2xl border border-white/[0.1] bg-[#0c0d0e]">
            {/* Header: service + live status pill */}
            <div className="flex items-center gap-3 border-b border-white/[0.07] px-5 py-3">
              <span className="grid size-6 place-items-center rounded-md border border-white/10 bg-white/[0.04] text-[0.625rem] font-bold text-white/70">
                W
              </span>
              <Mono className="text-white/80">storefront / web</Mono>
              <span
                className={cx(
                  "ml-auto flex items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-[0.625rem] font-medium uppercase transition-colors duration-300",
                  running
                    ? "bg-[#4ade80]/15 text-[#4ade80]"
                    : active.key === "pending"
                      ? "bg-white/10 text-white/60"
                      : "bg-[#fbbf24]/15 text-[#fbbf24]",
                )}
              >
                <span
                  className={cx(
                    "size-1.5 rounded-full",
                    running
                      ? "bg-[#4ade80]"
                      : active.key === "pending"
                        ? "bg-white/40"
                        : "bg-[#fbbf24] motion-safe:animate-pulse",
                  )}
                />
                {active.key}
              </span>
            </div>

            {/* The rail */}
            <div className="px-5 pt-9 pb-6 sm:px-8">
              <div className="relative">
                <div
                  aria-hidden
                  className="absolute top-1 right-0 left-0 hidden h-px -translate-y-1/2 bg-white/10 sm:block"
                />
                <div
                  aria-hidden
                  className="absolute top-1 left-0 hidden h-px -translate-y-1/2 bg-[#3d7bfb] transition-[width] duration-500 ease-out sm:block"
                  style={{ width: `${progress}%` }}
                />
                {!running ? (
                  <span
                    aria-hidden
                    className="absolute top-1 hidden size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#3d7bfb] shadow-[0_0_12px_2px_rgba(61,123,251,0.7)] transition-[left] duration-500 ease-out motion-safe:animate-pulse sm:block"
                    style={{ left: `${progress}%` }}
                  />
                ) : null}

                <ol className="relative grid grid-cols-2 gap-y-6 sm:grid-cols-7 sm:gap-y-0">
                  {PIPELINE_PHASES.map((phase, i) => {
                    const done = i < step;
                    const now = i === step;
                    return (
                      <li
                        key={phase.key}
                        className="flex min-w-0 flex-col items-start gap-2.5 pr-3"
                      >
                        <span
                          className={cx(
                            "relative z-10 size-2.5 rounded-full ring-4 ring-[#0c0d0e] transition-colors duration-300",
                            done ? "bg-[#3d7bfb]" : now ? "bg-white" : "bg-white/15",
                          )}
                        />
                        <span className="min-w-0">
                          <Mono
                            className={cx(
                              "block truncate transition-colors duration-300",
                              done || now ? "text-white/90" : "text-white/35",
                            )}
                          >
                            {phase.key}
                          </Mono>
                          <Mono
                            className={cx(
                              "mt-1 block truncate transition-colors duration-300",
                              now ? "text-[#8a8f98]" : "text-white/25",
                            )}
                          >
                            {phase.note}
                          </Mono>
                        </span>
                      </li>
                    );
                  })}
                </ol>
              </div>
            </div>

            {/* Streaming detail line for the active phase */}
            <div className="flex items-center gap-3 border-t border-white/[0.07] bg-white/[0.015] px-5 py-3 sm:px-8">
              <span
                className={cx(
                  "size-1.5 shrink-0 rounded-full transition-colors duration-300",
                  running ? "bg-[#4ade80]" : "bg-[#fbbf24]",
                )}
              />
              <Mono
                key={active.key}
                className="min-w-0 flex-1 truncate text-white/70 motion-safe:[animation:od-lineIn_.4s_ease]"
              >
                {active.detail}
              </Mono>
              <Mono className="shrink-0 text-white/35">
                {running ? "done" : `${step + 1}/${TOTAL}`}
              </Mono>
            </div>
          </div>
        </Reveal>
      </Container>
    </Band>
  );
}
