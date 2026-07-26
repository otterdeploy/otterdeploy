/**
 * The hero's subject: a swept delta craft built from a halftone dot lattice,
 * climbing on a diagonal and dissolving into its own trail at the tail.
 *
 * It is deliberately a *form with a gesture*, not an abstract solid — the panel
 * needs a subject that reads instantly as "ship it" from across the room, and a
 * centred object with no direction reads as decoration. Geometry only; the
 * renderer lives in `auth-hero-scene.ts`.
 */

import { mulberry32, TAU } from "@/features/auth/components/auth-hero-field";

/** Craft-local space: nose points along +z, +y is down, +x is starboard. */
const NOSE = { x: 0, y: 0, z: 1.18 };
const TAIL = { x: 0, y: 0.04, z: -0.98 };
const TIP_L = { x: -1.02, y: 0.26, z: -0.78 };
const TIP_R = { x: 1.02, y: 0.26, z: -0.78 };
/** The folded-under inner flaps that give a paper dart its keel. */
const FOLD_L = { x: -0.3, y: 0.42, z: -0.84 };
const FOLD_R = { x: 0.3, y: 0.42, z: -0.84 };

/** Attitude: nose up and turned out of frame, with a touch of bank. */
export const CRAFT_YAW = 0.56;
export const CRAFT_PITCH = 0.42;
export const CRAFT_BANK = 0.1;
/** Perspective for the craft's own projection — shallow, so it foreshortens
 *  without the wide-angle distortion a low focal length would add. */
export const CRAFT_FOCAL = 5;

/** Where the trail is born, in craft-local space. */
export const TRAIL_ORIGIN = { x: 0, y: 0.14, z: -0.82 };

export interface CraftDot {
  x: number;
  y: number;
  z: number;
  nx: number;
  ny: number;
  nz: number;
  /** Per-dot opacity and radius multiplier. */
  a: number;
  s: number;
}

interface Vec {
  x: number;
  y: number;
  z: number;
}

function normalOf(p0: Vec, p1: Vec, p2: Vec) {
  const ax = p1.x - p0.x;
  const ay = p1.y - p0.y;
  const az = p1.z - p0.z;
  const bx = p2.x - p0.x;
  const by = p2.y - p0.y;
  const bz = p2.z - p0.z;
  const nx = ay * bz - az * by;
  const ny = az * bx - ax * bz;
  const nz = ax * by - ay * bx;
  const l = Math.hypot(nx, ny, nz) || 1;
  return { x: nx / l, y: ny / l, z: nz / l };
}

/**
 * Samples a triangle on a barycentric lattice.
 *
 * `p0` is the keel-forward corner: density and dot size fall off along the
 * `p0 → p1` axis, so the surface is solid at the nose and thins to nothing at
 * the tail, where the trail takes over. That dissolve is the whole effect —
 * a uniformly dense triangle reads as a cut-out, not as something moving.
 */
function sampleTriangle(
  out: CraftDot[],
  rnd: () => number,
  p0: Vec,
  p1: Vec,
  p2: Vec,
  steps: number,
  weight: number,
) {
  const n = normalOf(p0, p1, p2);
  for (let i = 0; i <= steps; i++) {
    const u = i / steps;
    const cols = Math.max(1, Math.round((steps - i) * 1));
    for (let j = 0; j <= cols; j++) {
      const v = (j / cols) * (1 - u);
      const w = 1 - u - v;
      if (w < 0) continue;
      // Dissolve toward the tail, and thin slightly toward the wing edge.
      const solidity = (1 - u) ** 1.35;
      if (rnd() > 0.45 + 0.55 * solidity) continue;
      out.push({
        x: p0.x * w + p1.x * u + p2.x * v,
        y: p0.y * w + p1.y * u + p2.y * v,
        z: p0.z * w + p1.z * u + p2.z * v,
        nx: n.x,
        ny: n.y,
        nz: n.z,
        a: (0.62 + 0.45 * solidity) * weight * (0.85 + rnd() * 0.25),
        s: 0.72 + 0.55 * solidity,
      });
    }
  }
}

/** Dense dot run along an edge — this is what gives the craft a hard silhouette
 *  instead of a fuzzy cloud, the same way the plate rings did on the stack. */
function sampleEdge(
  out: CraftDot[],
  rnd: () => number,
  p0: Vec,
  p1: Vec,
  n: Vec,
  steps: number,
  weight: number,
) {
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const solidity = (1 - t) ** 1.2;
    if (rnd() > 0.55 + 0.45 * solidity) continue;
    out.push({
      x: p0.x + (p1.x - p0.x) * t,
      y: p0.y + (p1.y - p0.y) * t,
      z: p0.z + (p1.z - p0.z) * t,
      nx: n.x,
      ny: n.y,
      nz: n.z,
      a: (0.72 + 0.28 * solidity) * weight,
      s: 0.95 + 0.35 * solidity,
    });
  }
}

export function buildCraft(): CraftDot[] {
  const rnd = mulberry32(0x0c2af7);
  const dots: CraftDot[] = [];

  // ── Upper wings ──
  sampleTriangle(dots, rnd, NOSE, TAIL, TIP_L, 66, 1);
  sampleTriangle(dots, rnd, NOSE, TAIL, TIP_R, 66, 1);
  // ── Folded keel flaps: the depth cue that makes it a dart, not a kite ──
  sampleTriangle(dots, rnd, NOSE, TAIL, FOLD_L, 32, 0.78);
  sampleTriangle(dots, rnd, NOSE, TAIL, FOLD_R, 32, 0.78);

  // ── Silhouette edges ──
  const nl = normalOf(NOSE, TAIL, TIP_L);
  const nr = normalOf(NOSE, TAIL, TIP_R);
  sampleEdge(dots, rnd, NOSE, TIP_L, nl, 150, 1.15);
  sampleEdge(dots, rnd, NOSE, TIP_R, nr, 150, 1.15);
  sampleEdge(dots, rnd, TIP_L, TAIL, nl, 54, 0.8);
  sampleEdge(dots, rnd, TIP_R, TAIL, nr, 54, 0.8);
  sampleEdge(dots, rnd, NOSE, TAIL, { x: 0, y: -1, z: 0 }, 120, 1.1);

  return dots;
}

/** Rotation matrix rows for the craft's attitude, rebuilt when the bank drifts. */
export function craftBasis(bank: number) {
  const cb = Math.cos(bank);
  const sb = Math.sin(bank);
  const cp = Math.cos(CRAFT_PITCH);
  const sp = Math.sin(CRAFT_PITCH);
  const cy = Math.cos(CRAFT_YAW);
  const sy = Math.sin(CRAFT_YAW);
  // bank (Z) → pitch (X) → yaw (Y), pre-multiplied.
  return {
    m00: cy * cb + sy * sp * sb,
    m01: -cy * sb + sy * sp * cb,
    m02: sy * cp,
    m10: cp * sb,
    m11: cp * cb,
    m12: -sp,
    m20: -sy * cb + cy * sp * sb,
    m21: sy * sb + cy * sp * cb,
    m22: cy * cp,
  };
}

export type CraftBasis = ReturnType<typeof craftBasis>;

export function rotateCraft(b: CraftBasis, x: number, y: number, z: number) {
  return {
    x: b.m00 * x + b.m01 * y + b.m02 * z,
    y: b.m10 * x + b.m11 * y + b.m12 * z,
    z: b.m20 * x + b.m21 * y + b.m22 * z,
  };
}

export { TAU };
