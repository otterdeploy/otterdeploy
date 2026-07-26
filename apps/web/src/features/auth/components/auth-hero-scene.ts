import type { Scene } from "@/features/auth/components/auth-hero-camera";
import type { Spark } from "@/features/auth/components/auth-hero-field";

import { offscreen, project } from "@/features/auth/components/auth-hero-camera";
import {
  CAM_HEIGHT,
  LIGHT,
  MAX_SPARKS,
  plateLift,
  SPARK_RATE,
  STACK_FOOTPRINT,
  STACK_SHADOW,
  STACK_X,
  STACK_Z,
  SWELL,
  TAU,
  TOP_PLATE,
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

function drawNodes(s: Scene, ring: number | null) {
  const { ctx } = s;
  const swellT = s.clock * 0.32;
  const amp = ring === null ? 0 : waveAmplitude(ring);

  for (const n of s.field) {
    // The stack stands on these nodes; clearing its footprint keeps it from
    // looking transparent, and the ring of nodes just outside it darkens into a
    // contact shadow.
    const gx = n.x - STACK_X;
    const gz = n.z - STACK_Z;
    const gr = Math.hypot(gx, gz);
    if (gr < STACK_FOOTPRINT) continue;
    const shadow = gr > STACK_SHADOW ? 1 : 0.25 + 0.75 * ((gr - STACK_FOOTPRINT) / (STACK_SHADOW - STACK_FOOTPRINT));

    const sx = Math.sin(n.x * 0.55 + swellT + n.p * 0.12);
    const cz = Math.cos(n.z * 0.42 - swellT * 0.7);
    let height = sx * cz * SWELL;
    let crestF = 0;
    let slope = 0;
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

    const alpha =
      n.a * (0.14 + 0.72 * lambert) * (0.15 + 0.85 * proj.fog ** 1.5) * shadow * s.inkAlpha;
    // Capped as well as floored — oversized foreground dots read as soft blobs
    // and blur the whole lower half of the panel.
    const size = Math.min(
      2.3 * s.dpr,
      Math.max(0.4 * s.dpr, (0.35 + 1.25 * proj.fog) * (0.8 + 0.5 * lambert) * n.s * s.sizeGain * s.dpr),
    );

    // Only the crest itself carries the accent, and it falls back to neutral
    // within a node or two of the peak.
    const mix = crestF > 0.3 ? Math.min(1, (crestF - 0.3) / 0.6) : 0;
    ctx.globalAlpha = Math.min(1, alpha + mix * 0.32 * s.inkAlpha);
    ctx.fillStyle = mix > 0.45 ? s.accent : s.fg;
    ctx.beginPath();
    ctx.arc(proj.sx, proj.sy, size + mix * 0.7 * s.dpr, 0, TAU);
    ctx.fill();
  }
}

function drawStack(s: Scene, lift: number) {
  const { ctx } = s;
  ctx.fillStyle = s.fg;
  for (const d of s.stack) {
    const y = CAM_HEIGHT + d.y + (d.plate === TOP_PLATE ? lift : 0);
    const proj = project(s, d.x, y, d.z);
    if (!proj || offscreen(s, proj.sx, proj.sy)) continue;
    const lambert = Math.max(0, d.nx * LIGHT.x + d.ny * LIGHT.y + d.nz * LIGHT.z);
    ctx.globalAlpha = Math.min(1, d.a * (0.42 + 0.7 * lambert) * s.inkAlpha);
    // Floored at a full pixel: sub-pixel dots antialias into grey haze, which is
    // exactly what made the earlier stack read as blurred rather than built.
    const r = Math.max(0.95 * s.dpr, (0.72 + 0.5 * lambert) * d.s * s.sizeGain * s.dpr);
    ctx.beginPath();
    ctx.arc(proj.sx, proj.sy, r, 0, TAU);
    ctx.fill();
  }
}

function newSpark(s: Scene, lift: number): Spark {
  const a = s.rnd() * TAU;
  const r = s.rnd() * 0.36;
  return {
    x: STACK_X + Math.cos(a) * r,
    y: CAM_HEIGHT - 0.68 + lift,
    z: STACK_Z + Math.sin(a) * r,
    vx: 0.04 + s.rnd() * 0.12,
    vy: -(0.14 + s.rnd() * 0.18),
    age: 0,
    ttl: 1.6 + s.rnd() * 1.2,
  };
}

function drawSparks(s: Scene, dt: number) {
  const { ctx } = s;
  for (let i = s.sparks.length - 1; i >= 0; i--) {
    const q = s.sparks[i];
    if (!q) continue;
    q.age += dt;
    if (q.age >= q.ttl) {
      s.sparks.splice(i, 1);
      continue;
    }
    q.x += q.vx * dt;
    q.y += q.vy * dt;
    q.vy += 0.09 * dt;

    const proj = project(s, q.x, q.y, q.z);
    if (!proj) continue;
    const t = q.age / q.ttl;
    const fade = Math.min(1, t / 0.16) * (1 - t) ** 1.2;
    if (fade <= 0.01) continue;

    if (s.glow) {
      const g = s.glow.width * (0.4 + 0.6 * proj.fog);
      ctx.globalAlpha = fade * 0.7;
      ctx.drawImage(s.glow, proj.sx - g / 2, proj.sy - g / 2, g, g);
    }
    ctx.globalAlpha = fade * 0.9;
    ctx.fillStyle = s.accent;
    ctx.beginPath();
    ctx.arc(proj.sx, proj.sy, Math.max(0.4, (0.4 + 0.9 * proj.fog) * s.dpr), 0, TAU);
    ctx.fill();
  }
}

export function drawScene(s: Scene, dt: number) {
  s.ctx.clearRect(0, 0, s.w, s.h);
  const ring = wavePos(s.clock);
  const lift = plateLift(s.clock);
  drawNodes(s, ring);
  drawStack(s, lift);
  drawSparks(s, dt);
  s.ctx.globalAlpha = 1;

  // Spray only while the top plate is handing over, not for the whole ripple.
  if (lift === 0) {
    s.sparkAcc = 0;
    return;
  }
  s.sparkAcc += dt * SPARK_RATE;
  while (s.sparkAcc >= 1 && s.sparks.length < MAX_SPARKS) {
    s.sparkAcc -= 1;
    s.sparks.push(newSpark(s, lift));
  }
  if (s.sparkAcc > 1) s.sparkAcc = 1;
}

/** One composed still for `prefers-reduced-motion`: the ripple part-way out,
 *  its spray already mid-flight, so the picture still has a subject. */
export function drawSceneStill(s: Scene) {
  s.clock = WAVE_TRAVEL * 0.34;
  s.sparks.length = 0;
  s.sparkAcc = 0;
  for (let i = 0; i < MAX_SPARKS; i++) {
    const q = newSpark(s, 0);
    // Advance along its arc so the spray trails instead of sitting on the plate
    // in a clump.
    const steps = Math.round((s.rnd() * q.ttl * 0.8) / 0.05);
    for (let k = 0; k < steps; k++) {
      q.x += q.vx * 0.05;
      q.y += q.vy * 0.05;
      q.vy += 0.09 * 0.05;
      q.age += 0.05;
    }
    s.sparks.push(q);
  }
  drawScene(s, 0);
}
