/**
 * Camera, framing and per-surface state for the sign-in hero. The draw passes
 * live in `auth-hero-scene.ts`; this module owns where everything lands.
 *
 * The scene is staged with two independent cameras on purpose. The horizon is a
 * ground plane seen from a fixed low eye, while the craft is art-directed
 * straight onto the canvas: anchor point and radius as fractions of the
 * surface. Deriving the craft from the ground camera would chain its size and
 * position to the horizon and leave no way to compose the panel.
 */

import type { CraftDot } from "@/features/auth/components/auth-hero-craft";
import type { FieldNode, Spark } from "@/features/auth/components/auth-hero-field";

import { buildCraft } from "@/features/auth/components/auth-hero-craft";
import {
  buildField,
  CAM_DIST,
  FOCAL,
  makeGlowSprite,
  mulberry32,
  TILT,
  Z_FAR,
} from "@/features/auth/components/auth-hero-field";

/** How the scene is framed. `panel` is the tall desktop brand column; `band` is
 *  the short mobile/tablet strip above the form. */
export type HeroLayout = "panel" | "band";

export interface Scene {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  layout: HeroLayout;
  field: FieldNode[];
  craft: CraftDot[];
  sparks: Spark[];
  rnd: () => number;
  dpr: number;
  w: number;
  h: number;
  /** Ground camera: projection centre and world→pixel zoom. */
  cx: number;
  cy: number;
  scale: number;
  sizeGain: number;
  /** Craft camera: screen anchor and radius, in device pixels. */
  craftX: number;
  craftY: number;
  craftR: number;
  fg: string;
  accent: string;
  inkAlpha: number;
  glowStrength: number;
  glow: HTMLCanvasElement | null;
  /** Scene clock, seconds. Drives the swell, the ripple and the craft's drift. */
  clock: number;
  sparkAcc: number;
}

const cosT = Math.cos(TILT);
const sinT = Math.sin(TILT);
/** Screen offset from the projection centre up to the ground plane's horizon. */
const HORIZON_DROP = Math.tan(TILT) * FOCAL;

function framingFor(layout: HeroLayout) {
  // The craft owns the upper two thirds and the horizon closes the bottom.
  if (layout === "band") return { horizon: 0.94, craftX: 0.57, craftY: 0.4, craftR: 0.23 };
  return { horizon: 0.72, craftX: 0.58, craftY: 0.4, craftR: 0.27 };
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
    craft: buildCraft(),
    sparks: [],
    rnd: mulberry32(0x51a17),
    dpr: 1,
    w: 0,
    h: 0,
    cx: 0,
    cy: 0,
    scale: 0,
    sizeGain: 1,
    craftX: 0,
    craftY: 0,
    craftR: 0,
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
  return sx < -40 || sx > s.w + 40 || sy < -40 || sy > s.h + 40;
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
  s.inkAlpha = dark ? 1 : 0.66;
  s.glowStrength = dark ? 0.4 : 0.16;
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

  const f = framingFor(s.layout);
  s.scale = Math.min(520 * s.dpr, Math.max(170 * s.dpr, s.w * 0.32));
  s.cx = s.w * 0.5;
  s.cy = s.h * f.horizon + HORIZON_DROP * s.scale;
  s.craftX = s.w * f.craftX;
  s.craftY = s.h * f.craftY;
  s.craftR = Math.min(s.w * f.craftR, s.h * f.craftR * 1.25);
  s.field = buildField(s.w, s.scale);
  // Dots grow with the surface so a 1920 screen reads as dense as a 1280 one
  // instead of thinning into scattered specks.
  s.sizeGain = Math.min(1.5, Math.max(0.8, s.scale / (330 * s.dpr)));
  s.glow = makeGlowSprite(Math.round(26 * s.dpr), s.accent, s.glowStrength);
  return true;
}
