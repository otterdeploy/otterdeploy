/**
 * The world the sign-in hero renders: a lattice of nodes running to a horizon,
 * and the deploy wave that rolls outward through it. Geometry and constants
 * only — see `auth-hero-scene.ts` for the renderer and `auth-hero.tsx` for the
 * React wiring.
 */

export const TAU = Math.PI * 2;

/** Camera: pitched down onto the field, which sits below the eye line. */
export const CAM_DIST = 2.6;
export const CAM_HEIGHT = 0.92;
export const FOCAL = 2.5;
export const TILT = 0.3;

/** The lattice is perspective-aware: each row is only as wide as it needs to be
 *  to reach the panel edges at its own depth, and rows open up as they recede,
 *  so node count tracks what is visible instead of the world box. */
export const X_CENTER = 0;
/** Only the depths that actually land on the canvas are generated — nearer rows
 *  project below the bottom edge and would be pure cull cost. */
export const Z_NEAR = -0.9;
export const Z_FAR = 11;
export const rowStep = (z: number) => 0.06 + (z + 1.6) * 0.016;

/** Resting swell — barely there, so the field reads as calm, not as water. */
export const SWELL = 0.05;

/** Ground point the deploy ripple radiates from — under the craft, so the
 *  horizon reacts to the thing flying over it. */
export const RIPPLE_X = 0.4;
export const RIPPLE_Z = 3.4;

/** One deploy: the ripple travels out across the horizon, then the field rests. */
export const WAVE_TRAVEL = 6.5;
export const WAVE_REST = 3.2;
export const WAVE_CYCLE = WAVE_TRAVEL + WAVE_REST;
/** Crest height and half-width, world units, and how far the ring travels. */
export const WAVE_HEIGHT = 0.22;
export const WAVE_WIDTH = 0.62;
export const WAVE_FROM = 0.5;
export const WAVE_TO = 9;

/** The craft's trail. Blue lands here and on the ripple crest only — DESIGN.md
 *  caps the accent near 10% of a surface. */
export const MAX_SPARKS = 150;
export const SPARK_RATE = 72;

/** Direction *to* the key light — upper left, front. Matches the panel glow. */
export const LIGHT = { x: -0.46, y: -0.76, z: -0.46 };

export interface FieldNode {
  x: number;
  z: number;
  /** Per-node grain, so the lattice has texture instead of one flat tone. */
  a: number;
  s: number;
  /** Phase offset for the resting swell. */
  p: number;
}

export interface Spark {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  age: number;
  ttl: number;
}

/** Deterministic PRNG so the field is identical on every mount and reload. */
export function mulberry32(seed: number) {
  let t = seed;
  return () => {
    t = (t + 0x6d2b79f5) | 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Builds the ground lattice for the current framing. Each row is generated only
 * as wide as the canvas actually needs at its own depth — the camera is zoomed
 * in far enough that a fixed world box would spend most of its nodes off-screen.
 */
export function buildField(canvasWidth: number, scale: number): FieldNode[] {
  const rnd = mulberry32(0x0f1e1d);
  const nodes: FieldNode[] = [];
  const sinT = Math.sin(TILT);
  const cosT = Math.cos(TILT);
  const halfAt = (z: number) =>
    (canvasWidth / 2) * ((CAM_HEIGHT * sinT + z * cosT + CAM_DIST) / (FOCAL * scale)) + 0.7;
  let row = 0;
  for (let z = Z_NEAR; z < Z_FAR; z += rowStep(z)) {
    const step = rowStep(z);
    const half = halfAt(z);
    // Stagger alternate rows by a half step: a square lattice moirés badly
    // under perspective.
    const offset = (row % 2) * step * 0.5;
    for (let x = X_CENTER - half + offset; x < X_CENTER + half; x += step) {
      nodes.push({
        // Jitter within the cell: without it the shared x positions line up
        // into hard radial rays running back to the vanishing point.
        x: x + (rnd() - 0.5) * step * 0.4,
        z: z + (rnd() - 0.5) * step * 0.25,
        a: 0.62 + rnd() * 0.38,
        s: 0.8 + rnd() * 0.4,
        p: rnd() * TAU,
      });
    }
    row++;
  }
  return nodes;
}

/** Ripple radius at time `t`, or null while the field is at rest. */
export function wavePos(t: number) {
  const phase = t % WAVE_CYCLE;
  if (phase >= WAVE_TRAVEL) return null;
  const u = phase / WAVE_TRAVEL;
  // Eased so the ring moves at a roughly even *screen* speed: a constant world
  // speed would blur past the near rows and then crawl at the horizon.
  return WAVE_FROM + (WAVE_TO - WAVE_FROM) * u ** 1.7;
}

/** The ripple loses height as it spreads, so the far field only shimmers. */
export function waveAmplitude(radius: number) {
  return WAVE_HEIGHT * Math.exp(-radius * 0.17);
}

/** Pre-rendered soft glow, blitted per spark — far cheaper than shadowBlur.
 *  `strength` is pulled down in light mode, where a soft halo on an off-white
 *  panel reads as a smudge rather than as light. */
export function makeGlowSprite(size: number, color: string, strength: number) {
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const g = c.getContext("2d");
  if (!g) return c;
  const half = size / 2;
  const grad = g.createRadialGradient(half, half, 0, half, half, half);
  grad.addColorStop(0, color);
  grad.addColorStop(0.3, color);
  grad.addColorStop(1, "transparent");
  g.globalAlpha = strength;
  g.fillStyle = grad;
  g.beginPath();
  g.arc(half, half, half, 0, TAU);
  g.fill();
  return c;
}
