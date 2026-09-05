import { useEffect, useRef } from "react";

import {
  createScene,
  drawScene,
  drawSceneStill,
  readSceneColors,
  resizeScene,
} from "./hero-scene/scene";

/**
 * The sign-in page's dot-matrix scene, mounted behind the landing hero: the
 * paper-dart craft over a lattice horizon, a deploy ripple rolling through the
 * fleet. Same renderer as apps/web's auth hero (ported to hero-scene/), with
 * the landing's dark-only tokens. Reduced motion gets one composed still; the
 * loop stops while the tab is hidden, the hero is offscreen, or the canvas has
 * no layout box.
 */
export function HeroCanvas({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const scene = createScene(canvas, ctx, "wide");
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0;
    let last = 0;
    let inViewport = typeof IntersectionObserver === "undefined";

    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      if (scene.w === 0) return;
      const dt = last === 0 ? 0.016 : Math.min(0.05, (now - last) / 1000);
      last = now;
      scene.clock += dt;
      drawScene(scene, dt);
    };

    const start = () => {
      if (frame !== 0 || scene.w === 0 || document.hidden || !inViewport) return;
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

    const reconcile = () => {
      if (scene.w === 0 || document.hidden || !inViewport) {
        stop();
        return;
      }
      if (reduced.matches) {
        stop();
        drawSceneStill(scene);
        return;
      }
      start();
    };

    const refresh = () => {
      const visible = resizeScene(scene);
      readSceneColors(scene);
      if (!visible) {
        stop();
        return;
      }
      reconcile();
    };

    const onVisibility = () => reconcile();

    const onReducedChange = () => {
      stop();
      reconcile();
    };

    const intersection =
      typeof IntersectionObserver === "undefined"
        ? null
        : new IntersectionObserver((entries) => {
            inViewport = entries.some((entry) => entry.isIntersecting);
            reconcile();
          });

    const ro = new ResizeObserver(refresh);
    ro.observe(canvas);
    intersection?.observe(canvas);
    document.addEventListener("visibilitychange", onVisibility);
    reduced.addEventListener("change", onReducedChange);
    refresh();

    return () => {
      stop();
      ro.disconnect();
      intersection?.disconnect();
      reduced.removeEventListener("change", onReducedChange);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className={className}
      style={{ display: "block", width: "100%", height: "100%" }}
    />
  );
}
