import type { Scene } from "@/features/auth/components/auth-hero-camera";
import type { CraftBasis } from "@/features/auth/components/auth-hero-craft";
import type { Spark } from "@/features/auth/components/auth-hero-field";

import { offscreen, project } from "@/features/auth/components/auth-hero-camera";
import {
  CRAFT_BANK,
  CRAFT_FOCAL,
  craftBasis,
  rotateCraft,
  TRAIL_ORIGIN,
} from "@/features/auth/components/auth-hero-craft";
import {
  CAM_HEIGHT,
  LIGHT,
  MAX_SPARKS,
  RIPPLE_X,
  RIPPLE_Z,
  SPARK_RATE,
  SWELL,
  TAU,
  waveAmplitude,
  wavePos,
  WAVE_TRAVEL,
  WAVE_WIDTH,
} from "@/features/auth/components/auth-hero-field";

// Re-exported so callers have a single entry point for the hero renderer.
export type { HeroLayout, Scene } from "@/features/auth/components/auth-hero-camera";
export {
  createScene,
  readSceneColors,
  resizeScene,
} from "@/features/auth/components/auth-hero-camera";

/** The craft climbs a hair and banks a hair, on periods long enough that the
 *  motion registers as "airborne" rather than as an animation playing. */
function craftDrift(clock: number) {
  return {
    bank: CRAFT_BANK + Math.sin(clock * 0.21) * 0.055,
    rise: Math.sin(clock * 0.16) * 0.028 - Math.cos(clock * 0.09) * 0.012,
  };
}

function drawNodes(s: Scene, ring: number | null) {
  const { ctx } = s;
  const swellT = s.clock * 0.32;
  const amp = ring === null ? 0 : waveAmplitude(ring);
  ctx.fillStyle = s.fg;

  for (const n of s.field) {
    const sx = Math.sin(n.x * 0.55 + swellT + n.p * 0.12);
    const cz = Math.cos(n.z * 0.42 - swellT * 0.7);
    let height = sx * cz * SWELL;
    let crestF = 0;
    let slope = 0;
    const gx = n.x - RIPPLE_X;
    const gz = n.z - RIPPLE_Z;
    const gr = Math.hypot(gx, gz) || 1e-4;
    if (ring !== null) {
      const d = (gr - ring) / WAVE_WIDTH;
      crestF = d > -3 && d < 3 ? Math.exp(-d * d * 1.6) : 0;
      height += amp * crestF;
      slope = (-3.2 * d * amp * crestF) / WAVE_WIDTH;
    }

    const proj = project(s, n.x, CAM_HEIGHT - height, n.z);
    if (!proj || offscreen(s, proj.sx, proj.sy)) continue;

    // The analytic slope of the height field gives a real surface normal, which
    // is what separates a lit landscape from a screen of noise.
    const dhdx = Math.cos(n.x * 0.55 + swellT + n.p * 0.12) * cz * SWELL * 0.55 + (slope * gx) / gr;
    const dhdz = -sx * Math.sin(n.z * 0.42 - swellT * 0.7) * SWELL * 0.42 + (slope * gz) / gr;
    const nl = Math.hypot(dhdx, 1, dhdz);
    const lambert = Math.max(0, (dhdx * LIGHT.x - LIGHT.y + dhdz * LIGHT.z) / nl);

    const alpha = n.a * (0.16 + 0.8 * lambert) * (0.15 + 0.85 * proj.fog ** 1.5) * s.inkAlpha;
    // Floored and capped: sub-pixel dots antialias into grey haze, oversized
    // ones read as soft blobs. Both blur the horizon.
    const size = Math.min(
      2.2 * s.dpr,
      Math.max(
        0.45 * s.dpr,
        (0.35 + 1.2 * proj.fog) * (0.8 + 0.5 * lambert) * n.s * s.sizeGain * s.dpr,
      ),
    );

    // The crest only brightens the lattice — colouring it turned the horizon
    // into a blue arc that fought the craft for attention.
    const mix = crestF > 0.3 ? Math.min(1, (crestF - 0.3) / 0.6) : 0;
    ctx.globalAlpha = Math.min(1, alpha + mix * 0.26 * s.inkAlpha);
    ctx.beginPath();
    ctx.arc(proj.sx, proj.sy, size + mix * 0.45 * s.dpr, 0, TAU);
    ctx.fill();
  }
}

/** Craft-local point → canvas. Its own shallow perspective, anchored on the
 *  art-directed centre rather than on the ground camera. */
function projectCraft(s: Scene, b: CraftBasis, x: number, y: number, z: number, rise: number) {
  const p = rotateCraft(b, x, y, z);
  const k = CRAFT_FOCAL / (CRAFT_FOCAL + p.z);
  return {
    sx: s.craftX + p.x * k * s.craftR,
    sy: s.craftY + (p.y + rise) * k * s.craftR,
    depth: k,
  };
}

function drawCraft(s: Scene, b: CraftBasis, rise: number) {
  const { ctx } = s;
  ctx.fillStyle = s.fg;
  for (const d of s.craft) {
    const proj = projectCraft(s, b, d.x, d.y, d.z, rise);
    if (offscreen(s, proj.sx, proj.sy)) continue;
    // Normals rotate with the hull; a paper surface is lit from either face, so
    // the term is taken absolute rather than clipped to the front side.
    const n = rotateCraft(b, d.nx, d.ny, d.nz);
    const lambert = Math.abs(n.x * LIGHT.x + n.y * LIGHT.y + n.z * LIGHT.z);
    const near = Math.max(0, Math.min(1, (proj.depth - 0.72) / 0.5));

    ctx.globalAlpha = Math.min(1, d.a * (0.5 + 0.95 * lambert) * (0.8 + 0.28 * near) * s.inkAlpha);
    // The craft carries the panel, so its dots run visibly heavier than the
    // horizon's — at one pixel they read as grey gauze rather than as a hull.
    const r = Math.max(
      1.05 * s.dpr,
      (0.95 + 0.85 * lambert) * (0.78 + 0.42 * near) * d.s * s.sizeGain * s.dpr,
    );
    ctx.beginPath();
    ctx.arc(proj.sx, proj.sy, r, 0, TAU);
    ctx.fill();
  }
}

/** Trail particles live in craft-local space: the craft barely rotates, and it
 *  keeps the spray aligned to the flight axis for free. */
function newSpark(s: Scene): Spark {
  const spread = 0.16;
  return {
    x: TRAIL_ORIGIN.x + (s.rnd() - 0.5) * 0.7,
    y: TRAIL_ORIGIN.y + (s.rnd() - 0.5) * spread,
    z: TRAIL_ORIGIN.z,
    vx: (s.rnd() - 0.5) * 0.12,
    vy: 0.02 + s.rnd() * 0.09,
    age: 0,
    ttl: 0.8 + s.rnd() * 1.1,
  };
}

function drawSparks(s: Scene, b: CraftBasis, rise: number, dt: number) {
  const { ctx } = s;
  for (let i = s.sparks.length - 1; i >= 0; i--) {
    const q = s.sparks[i];
    if (!q) continue;
    q.age += dt;
    if (q.age >= q.ttl) {
      s.sparks.splice(i, 1);
      continue;
    }
    // Falls behind the craft along its own axis, drifting apart as it goes.
    q.z -= 0.34 * dt;
    q.x += q.vx * dt;
    q.y += q.vy * dt;

    const proj = projectCraft(s, b, q.x, q.y, q.z, rise);
    if (offscreen(s, proj.sx, proj.sy)) continue;
    const t = q.age / q.ttl;
    const fade = Math.min(1, t / 0.1) * (1 - t) ** 1.5;
    if (fade <= 0.01) continue;
    // The spray starts as hull and cools to accent as it falls away.
    const blue = Math.min(1, Math.max(0, (t - 0.34) / 0.4));

    if (s.glow && blue > 0.4) {
      const g = s.glow.width * (0.35 + 0.5 * proj.depth);
      ctx.globalAlpha = fade * blue * 0.6;
      ctx.drawImage(s.glow, proj.sx - g / 2, proj.sy - g / 2, g, g);
    }
    ctx.globalAlpha = Math.min(1, fade * (0.75 + 0.35 * proj.depth) * s.inkAlpha);
    ctx.fillStyle = blue > 0.45 ? s.accent : s.fg;
    ctx.beginPath();
    ctx.arc(
      proj.sx,
      proj.sy,
      Math.max(0.95 * s.dpr, 1.7 * proj.depth * (1 - 0.4 * t) * s.dpr),
      0,
      TAU,
    );
    ctx.fill();
  }
}

export function drawScene(s: Scene, dt: number) {
  s.ctx.clearRect(0, 0, s.w, s.h);
  const { bank, rise } = craftDrift(s.clock);
  const b = craftBasis(bank);

  drawNodes(s, wavePos(s.clock));
  drawSparks(s, b, rise, dt);
  drawCraft(s, b, rise);
  s.ctx.globalAlpha = 1;

  s.sparkAcc += dt * SPARK_RATE;
  while (s.sparkAcc >= 1 && s.sparks.length < MAX_SPARKS) {
    s.sparkAcc -= 1;
    s.sparks.push(newSpark(s));
  }
  if (s.sparkAcc > 1) s.sparkAcc = 1;
}

/** One composed still for `prefers-reduced-motion`: ripple part-way out, trail
 *  already streaming, so the picture still has a subject in motion. */
export function drawSceneStill(s: Scene) {
  s.clock = WAVE_TRAVEL * 0.34;
  s.sparks.length = 0;
  s.sparkAcc = 0;
  for (let i = 0; i < MAX_SPARKS; i++) {
    const q = newSpark(s);
    const steps = Math.round((s.rnd() * q.ttl * 0.85) / 0.05);
    for (let k = 0; k < steps; k++) {
      q.z -= 0.34 * 0.05;
      q.x += q.vx * 0.05;
      q.y += q.vy * 0.05;
      q.age += 0.05;
    }
    s.sparks.push(q);
  }
  drawScene(s, 0);
}
