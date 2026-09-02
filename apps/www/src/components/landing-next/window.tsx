import { useEffect, useRef, useState } from "react";

import { cx } from "../landing/primitives";
import { HERO_SHOTS } from "./content";

/**
 * The hero window: REAL screenshots of the control plane, crossfading. The
 * surface control sits at the BOTTOM now — a row of labels, each with a thin
 * duration bar that fills over one cycle and then hands off to the next, the
 * way a stories/carousel progress rail reads. Auto-advances; hover pauses the
 * bar in place; a click jumps and restarts the count. Reduced motion holds
 * frame one with no bar and no loop.
 */

const CYCLE_MS = 4200;

export function AppWindow() {
  const [idx, setIdx] = useState(0);
  const [paused, setPaused] = useState(false);
  const reduced = useRef(false);

  useEffect(() => {
    reduced.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }, []);

  // Each surface holds for one full cycle, whether reached by the timer or a
  // click; keying the effect on idx restarts the count on every change.
  useEffect(() => {
    if (reduced.current || paused) return;
    const id = setTimeout(() => setIdx((i) => (i + 1) % HERO_SHOTS.length), CYCLE_MS);
    return () => clearTimeout(id);
  }, [idx, paused]);

  return (
    <figure
      aria-label="The otterdeploy control plane, across four real surfaces."
      className="-mb-px"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      {/* Screenshot stage */}
      <div className="relative max-h-[20rem] overflow-hidden rounded-t-xl border border-b-0 border-white/[0.1] bg-[#0c0d0e] sm:max-h-[26rem] lg:max-h-[32rem]">
        {HERO_SHOTS.map((shot, i) => (
          <img
            key={shot.key}
            src={shot.img}
            alt={i === idx ? shot.alt : ""}
            width={3200}
            height={1770}
            loading={i === 0 ? "eager" : "lazy"}
            decoding="async"
            className={cx("od-state absolute inset-0 w-full", i === idx && "is-active")}
          />
        ))}
        {/* Spacer: gives the absolutely-positioned frames a box to fill. */}
        <img
          src={HERO_SHOTS[0].img}
          alt=""
          aria-hidden
          width={3200}
          height={1770}
          className="invisible block w-full"
        />
      </div>

      {/* Surface control — labels + duration bars, at the bottom */}
      <div
        role="tablist"
        aria-label="Surface"
        className="grid grid-cols-2 gap-1 rounded-b-xl border border-white/[0.1] bg-[#0c0d0e] p-1.5 sm:grid-cols-4"
      >
        {HERO_SHOTS.map((shot, i) => (
          <button
            key={shot.key}
            type="button"
            role="tab"
            aria-selected={idx === i}
            onClick={() => setIdx(i)}
            className={cx(
              "group flex flex-col gap-2 rounded-md px-3 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-white/40",
              idx === i ? "bg-white/[0.05]" : "hover:bg-white/[0.025]",
            )}
          >
            <span
              className={cx(
                "text-[0.75rem] font-medium transition-colors duration-200",
                idx === i ? "text-white/90" : "text-white/45 group-hover:text-white/70",
              )}
            >
              {shot.tab}
            </span>
            <span className="h-[3px] w-full overflow-hidden rounded-full bg-white/[0.08]">
              {idx === i && (
                <span
                  key={idx}
                  className="od-progress block h-full w-0 rounded-full bg-[#3d7bfb]"
                  style={{
                    animationDuration: `${CYCLE_MS}ms`,
                    animationPlayState: paused ? "paused" : "running",
                  }}
                />
              )}
            </span>
          </button>
        ))}
      </div>
    </figure>
  );
}
