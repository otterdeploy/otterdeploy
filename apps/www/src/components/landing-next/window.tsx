import { useCallback, useEffect, useRef, useState } from "react";

import { cx } from "../landing/primitives";
import { HERO_SHOTS } from "./content";
import { usePageVisible } from "./use-page-visible";
import { useReducedMotion } from "./use-reduced-motion";
import { SurfaceControls } from "./window-controls";

/**
 * The hero window: REAL screenshots of the control plane, crossfading. The
 * surface control sits at the BOTTOM — a row of labels, each with a thin
 * duration bar that fills over one cycle and then hands off to the next, plus
 * an explicit rotation control. Hover pauses the bar in place; keyboard focus
 * stops rotation until the reader restarts it. Reduced motion starts on frame
 * one with no bar or loop while keeping every surface manually selectable.
 */

const CYCLE_MS = 4200;
const SCREENSHOT_WIDTHS = [800, 1200, 1600, 3200] as const;

export function screenshotWebpSrcSet(src: string) {
  const base = src.replace(/\.png$/, "");
  return SCREENSHOT_WIDTHS.map((width) => `${base}-${width}.webp ${width}w`).join(", ");
}

export const HERO_SCREENSHOT_SIZES =
  "(min-width: 76rem) 71rem, (min-width: 64rem) calc(100vw - 5rem), calc(100vw - 3rem)";

function ScreenshotStage({
  activeIndex,
  announceChanges,
  mountedFrames,
  onFrameLoaded,
}: {
  activeIndex: number;
  announceChanges: boolean;
  mountedFrames: ReadonlySet<number>;
  onFrameLoaded: (index: number) => void;
}) {
  return (
    <div
      id="control-plane-surface"
      role="group"
      aria-roledescription="slide"
      aria-label={`${HERO_SHOTS[activeIndex]?.tab ?? "Control plane"} surface, ${activeIndex + 1} of ${HERO_SHOTS.length}`}
      aria-live={announceChanges ? "polite" : "off"}
      aria-atomic="true"
      className="relative max-h-[20rem] overflow-hidden rounded-t-xl border border-b-0 border-white/[0.1] bg-[#0c0d0e] sm:max-h-[26rem] lg:max-h-[32rem]"
    >
      {HERO_SHOTS.map((shot, index) => {
        if (!mountedFrames.has(index)) return null;
        return (
          <picture key={shot.key}>
            <source
              type="image/webp"
              srcSet={screenshotWebpSrcSet(shot.img)}
              sizes={HERO_SCREENSHOT_SIZES}
            />
            <img
              src={shot.img}
              alt={index === activeIndex ? shot.alt : ""}
              aria-hidden={index !== activeIndex}
              width={3200}
              height={1770}
              loading={index === 0 ? "eager" : "lazy"}
              fetchPriority={index === 0 ? "high" : "auto"}
              decoding="async"
              onLoad={() => onFrameLoaded(index)}
              className={cx(
                "od-state absolute inset-0 w-full",
                index === activeIndex && "is-active",
              )}
            />
          </picture>
        );
      })}
      {/* Intrinsic spacer: preserves the frame without requesting the first image twice. */}
      <div aria-hidden className="invisible block w-full" style={{ aspectRatio: "3200 / 1770" }} />
    </div>
  );
}

export function AppWindow() {
  const [idx, setIdx] = useState(0);
  const [requestedIdx, setRequestedIdx] = useState(0);
  const [mountedFrames, setMountedFrames] = useState<ReadonlySet<number>>(() => new Set([0]));
  const [hovered, setHovered] = useState(false);
  const [userPaused, setUserPaused] = useState(false);
  const [inViewport, setInViewport] = useState(false);
  const pageVisible = usePageVisible();
  const reduced = useReducedMotion();
  const figureRef = useRef<HTMLElement>(null);
  const rotationWasPausedOnPointerDown = useRef(false);
  const requestedIdxRef = useRef(0);
  // Frame zero is already the active SSR image. Treating it as selectable does
  // not depend on an `onLoad` event that may fire before hydration attaches it.
  const loadedFrames = useRef(new Set<number>([0]));
  const remainingMs = useRef(CYCLE_MS);
  const startedAt = useRef<number | null>(null);

  const requestFrame = useCallback((nextIdx: number) => {
    requestedIdxRef.current = nextIdx;
    setRequestedIdx(nextIdx);
    setMountedFrames((current) => {
      if (current.has(nextIdx)) return current;
      const next = new Set(current);
      next.add(nextIdx);
      return next;
    });

    if (loadedFrames.current.has(nextIdx)) setIdx(nextIdx);
  }, []);

  const markFrameLoaded = useCallback((loadedIdx: number) => {
    loadedFrames.current.add(loadedIdx);
    if (requestedIdxRef.current === loadedIdx) setIdx(loadedIdx);
  }, []);

  useEffect(() => {
    const figure = figureRef.current;
    const intersection =
      figure && typeof IntersectionObserver !== "undefined"
        ? new IntersectionObserver(([entry]) => setInViewport(entry?.isIntersecting ?? false), {
            threshold: 0.01,
          })
        : null;

    if (figure && intersection) intersection.observe(figure);
    else setInViewport(true);

    return () => {
      intersection?.disconnect();
    };
  }, []);

  const rotationPaused = userPaused || hovered || reduced || !inViewport || !pageVisible;

  // A newly displayed frame or a motion-preference change starts a fresh
  // cycle. Transient pauses retain the remaining time so the progress rail and
  // JavaScript timer stay in sync when they resume.
  useEffect(() => {
    remainingMs.current = CYCLE_MS;
    startedAt.current = null;
  }, [idx, reduced]);

  useEffect(() => {
    if (rotationPaused || requestedIdx !== idx) return;

    const started = performance.now();
    startedAt.current = started;
    const id = setTimeout(() => {
      startedAt.current = null;
      remainingMs.current = CYCLE_MS;
      requestFrame((idx + 1) % HERO_SHOTS.length);
    }, remainingMs.current);

    return () => {
      clearTimeout(id);
      if (startedAt.current === started) {
        remainingMs.current = Math.max(0, remainingMs.current - (performance.now() - started));
        startedAt.current = null;
      }
    };
  }, [idx, requestFrame, requestedIdx, rotationPaused]);

  return (
    <figure
      ref={figureRef}
      role="group"
      aria-roledescription="carousel"
      aria-label="The otterdeploy control plane, across four real surfaces."
      className="-mb-px"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocusCapture={(event) => {
        const previous = event.relatedTarget;
        const enteredFromOutside =
          !(previous instanceof Node) || !event.currentTarget.contains(previous);
        if (enteredFromOutside) setUserPaused(true);
      }}
    >
      <ScreenshotStage
        activeIndex={idx}
        announceChanges={userPaused || reduced}
        mountedFrames={mountedFrames}
        onFrameLoaded={markFrameLoaded}
      />
      <SurfaceControls
        activeIndex={idx}
        cycleMs={CYCLE_MS}
        reduced={reduced}
        rotationPaused={rotationPaused}
        userPaused={userPaused}
        onPausePointerDown={() => {
          rotationWasPausedOnPointerDown.current = userPaused;
        }}
        onRequestFrame={requestFrame}
        onToggleRotation={(clickDetail) => {
          if (clickDetail > 0) {
            setUserPaused(!rotationWasPausedOnPointerDown.current);
          } else {
            setUserPaused((current) => !current);
          }
        }}
      />
    </figure>
  );
}
