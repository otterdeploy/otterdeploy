import { useEffect, useRef } from "react";

import type { HeroLayout } from "@/features/auth/components/auth-hero-scene";

import {
  createScene,
  drawScene,
  drawSceneStill,
  readSceneColors,
  resizeScene,
} from "@/features/auth/components/auth-hero-scene";

/**
 * The sign-in hero: a dot-matrix scene rendered on canvas.
 *
 * What it depicts, so future edits keep the metaphor honest. A stepped stack of
 * dot plates standing on a lattice of nodes that runs to a horizon. Every few
 * seconds the top plate lifts a hair, throws a little accent-blue spray, and a
 * ripple rolls outward from it across the whole field. That is a deploy handing
 * over and propagating through a fleet. Nothing here is bound to live data; it
 * is atmosphere, not a status readout.
 *
 * Craft constraints it has to respect:
 * - Colors come from the theme tokens at runtime and are re-read when the `dark`
 *   class flips, so one scene works on `#0c0c0b` and on `#fbfbfa`.
 * - Blue lands only on the wave crest and its spray (DESIGN.md caps the accent
 *   near 10% of a surface); the resting field is foreground-neutral.
 * - `prefers-reduced-motion` gets one composed still frame and never starts the
 *   animation loop.
 * - The loop never runs while the canvas has no layout box (the panel is
 *   `hidden` below `lg`) or while the tab is in the background.
 */
export function AuthHero({
  className,
  layout = "panel",
}: {
  className?: string;
  /** `panel` frames the copy above the horizon (desktop brand column); `band`
   *  frames a short strip with the copy over the foreground (mobile/tablet). */
  layout?: HeroLayout;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const scene = createScene(canvas, ctx, layout);
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0;
    let last = 0;

    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      if (scene.w === 0) return;
      const dt = last === 0 ? 0.016 : Math.min(0.05, (now - last) / 1000);
      last = now;
      scene.clock += dt;
      drawScene(scene, dt);
    };

    const start = () => {
      if (frame !== 0 || scene.w === 0) return;
      if (reduced.matches) {
        drawSceneStill(scene);
        return;
      }
      last = 0;
      frame = requestAnimationFrame(tick);
    };

    const stop = () => {
      if (frame !== 0) cancelAnimationFrame(frame);
      frame = 0;
    };

    const refresh = () => {
      const visible = resizeScene(scene);
      readSceneColors(scene);
      if (!visible) {
        stop();
        return;
      }
      if (reduced.matches) drawSceneStill(scene);
      else start();
    };

    const onVisibility = () => {
      if (document.hidden) stop();
      else start();
    };

    // next-themes toggles the `dark` class on <html>; re-read the tokens and
    // redraw the still frame when it does.
    const themeObserver = new MutationObserver(() => {
      readSceneColors(scene);
      if (reduced.matches || frame === 0) drawSceneStill(scene);
    });

    const onReducedChange = () => {
      stop();
      start();
    };

    const ro = new ResizeObserver(refresh);
    ro.observe(canvas);
    document.addEventListener("visibilitychange", onVisibility);
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style"],
    });
    reduced.addEventListener("change", onReducedChange);
    refresh();

    return () => {
      stop();
      ro.disconnect();
      themeObserver.disconnect();
      reduced.removeEventListener("change", onReducedChange);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [layout]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className={className}
      // The tokens the scene reads at runtime resolve against this element.
      style={{ display: "block", width: "100%", height: "100%" }}
    />
  );
}
