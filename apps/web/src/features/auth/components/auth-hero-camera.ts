/**
 * Camera, framing and per-surface state for the sign-in hero. The draw passes
 * live in `auth-hero-scene.ts`; this module owns where everything lands.
 */

import type { FieldNode, Spark, StackDot } from "@/features/auth/components/auth-hero-field";

import {
  buildField,
  buildStack,
  CAM_DIST,
  CAM_HEIGHT,
  FOCAL,
  makeGlowSprite,
  mulberry32,
  STACK_Z,
  TILT,
  Z_FAR,
} from "@/features/auth/components/auth-hero-field";

/** How the scene is framed. `panel` is the tall desktop brand column, where the
 *  copy sits above the horizon; `band` is the short mobile/tablet strip, where
 *  the copy sits over the field's foreground. */
export type HeroLayout = "panel" | "band";

/** Renderer for the sign-in hero. All mutable state lives on one object so the
 *  draw passes stay plain functions and the React layer only wires observers. */
export interface Scene {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  layout: HeroLayout;
  field: FieldNode[];
  stack: StackDot[];
  sparks: Spark[];
  rnd: () => number;
  dpr: number;
  w: number;
  h: number;
  cx: number;
  cy: number;
  scale: number;
  sizeGain: number;
  fg: string;
  accent: string;
  inkAlpha: number;
  glowStrength: number;
  glow: HTMLCanvasElement | null;
  /** Scene clock, seconds. Drives the swell, the ripple and the plate lift. */
  clock: number;
  sparkAcc: number;
}

const cosT = Math.cos(TILT);
const sinT = Math.sin(TILT);

/** How far below the horizon the stack's base sits, per unit of `scale`. Used
 *  to solve for the zoom that puts the horizon and the stack exactly where the
 *  composition wants them, instead of guessing a scale and hoping. */
const STACK_DROP =
  FOCAL *
  (sinT +
    (CAM_HEIGHT * cosT - STACK_Z * sinT) / (CAM_HEIGHT * sinT + STACK_Z * cosT + CAM_DIST));

/**
 * Composition targets as a fraction of surface height: where the horizon sits,
 * and where the stack stands on it.
 *
 * On the brand panel both slide with panel height. The copy block above is a
 * fixed pixel stack (wordmark, headline, pill, bullets), so it eats a big share
 * of a short `lg` window and a small share of a tall one — pinning constants
 * here would either collide with the last bullet or leave a dead band under it.
 */
function framingFor(layout: HeroLayout, cssHeight: number) {
  if (layout === "band") return { horizon: 0.16, stack: 0.58, cx: 0.62 };
  // The copy above is a fixed pixel block (wordmark + headline + one sentence),
  // so it eats a large share of a short `lg` window and a small share of a tall
  // one. Track that instead of the aspect ratio and the horizon always lands
  // just below the last line of copy.
  const horizon = Math.min(0.52, Math.max(0.3, 0.1 + 290 / cssHeight));
  return { horizon, stack: horizon + 0.4, cx: 0.5 };
}

export function createScene(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  layout: HeroLayout,
): Scene {
  return {
    canvas,
    ctx,
    layout,
    field: [],
    stack: buildStack(),
    sparks: [],
    rnd: mulberry32(0x51a17),
    dpr: 1,
    w: 0,
    h: 0,
    cx: 0,
    cy: 0,
    scale: 0,
    sizeGain: 1,
    fg: "#f5f5f0",
    accent: "#5b7cfa",
    inkAlpha: 1,
    glowStrength: 0.42,
    glow: null,
    clock: 0,
    sparkAcc: 0,
  };
}

export function project(s: Scene, x: number, y: number, z: number) {
  const yt = y * cosT - z * sinT;
  const zc = y * sinT + z * cosT + CAM_DIST;
  if (zc <= 0.2) return null;
  const k = (FOCAL / zc) * s.scale;
  return { sx: s.cx + x * k, sy: s.cy + yt * k, fog: fogAt(z) };
}

function fogAt(z: number) {
  return Math.max(0, Math.min(1, 1 - (z - 2) / (Z_FAR - 3)));
}

export function offscreen(s: Scene, sx: number, sy: number) {
  return sx < -30 || sx > s.w + 30 || sy < -30 || sy > s.h + 30;
}

function readToken(el: HTMLElement, name: string, fallback: string) {
  const value = getComputedStyle(el).getPropertyValue(name).trim();
  return value.length > 0 ? value : fallback;
}

export function readSceneColors(s: Scene) {
  s.fg = readToken(s.canvas, "--foreground", "#f5f5f0");
  s.accent = readToken(s.canvas, "--sidebar-primary", "#5b7cfa");
  // Dark ink on a light canvas reads far heavier than light ink on a dark one
  // at the same alpha; pull it back so the panel stays calm in both.
  const dark = document.documentElement.classList.contains("dark");
  s.inkAlpha = dark ? 1 : 0.62;
  s.glowStrength = dark ? 0.42 : 0.18;
  s.glow = makeGlowSprite(Math.round(26 * s.dpr), s.accent, s.glowStrength);
}

/** Returns false when the canvas has no layout box (the surface is hidden). */
export function resizeScene(s: Scene) {
  const rect = s.canvas.getBoundingClientRect();
  if (rect.width < 1 || rect.height < 1) {
    s.w = 0;
    s.h = 0;
    return false;
  }
  s.dpr = Math.min(2, window.devicePixelRatio || 1);
  s.w = Math.round(rect.width * s.dpr);
  s.h = Math.round(rect.height * s.dpr);
  s.canvas.width = s.w;
  s.canvas.height = s.h;
  // Solve the zoom from the composition instead of the other way round: the
  // horizon and the stack's base are pinned to fractions of the surface height,
  // and `scale` is whatever puts them there. Clamped by width so the stack
  // can't outgrow a narrow panel or shrink away on a very tall one.
  const f = framingFor(s.layout, s.h / s.dpr);
  s.scale = Math.min(
    s.w * 0.66,
    Math.max(s.w * 0.3, ((f.stack - f.horizon) * s.h) / STACK_DROP),
  );
  s.cx = s.w * f.cx;
  s.cy = s.h * f.horizon + sinT * FOCAL * s.scale;
  s.field = buildField(s.w, s.scale);
  // Dots grow with the surface so a 1920 screen reads as dense as a 1280 one
  // instead of thinning into scattered specks.
  s.sizeGain = Math.min(1.5, Math.max(0.8, s.scale / 420));
  s.glow = makeGlowSprite(Math.round(26 * s.dpr), s.accent, s.glowStrength);
  return true;
}
