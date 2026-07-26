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
export const Z_NEAR = 0.35;
export const Z_FAR = 11;
export const rowStep = (z: number) => 0.06 + (z + 1.6) * 0.016;

/** Resting swell — barely there, so the field reads as calm, not as water. */
export const SWELL = 0.05;

/** The stack: a stepped ziggurat of dot plates standing on the field. Radii
 *  taper hard on purpose — near-equal plates overlap into mush under a low
 *  camera, while a clear step keeps every tier's silhouette readable. */
export const STACK_X = X_CENTER;
/** Set back into the field, so a few rows of ground read in front of it. */
export const STACK_Z = 6;
export const PLATES = [
  { r: 1, top: -0.13, bottom: 0 },
  { r: 0.67, top: -0.42, bottom: -0.29 },
  { r: 0.41, top: -0.71, bottom: -0.58 },
] as const;
export const TOP_PLATE = PLATES.length - 1;
/** Superellipse exponent for a plate outline — 6 reads as a crisp squircle. */
export const SQ_P = 6;
/** Footprint the ground lattice is cleared inside, so the stack doesn't look
 *  transparent, plus the radius over which it darkens into a contact shadow. */
export const STACK_FOOTPRINT = 1.06;
export const STACK_SHADOW = 2.3;

/** One deploy: the ripple travels out from the stack, then the field rests. */
export const WAVE_TRAVEL = 6.5;
export const WAVE_REST = 3.2;
export const WAVE_CYCLE = WAVE_TRAVEL + WAVE_REST;
/** Crest height and half-width, world units, and how far the ring travels. */
export const WAVE_HEIGHT = 0.34;
export const WAVE_WIDTH = 0.62;
export const WAVE_FROM = 0.5;
export const WAVE_TO = 7;
/** How far the top plate lifts as it hands over, and how long the beat lasts. */
export const LIFT_MAX = 0.05;
export const LIFT_DURATION = 2.2;

/** Kept deliberately small: the spray plus the crest are the only accent-blue
 *  pixels on the panel, and DESIGN.md caps the accent near 10% of a surface. */
export const MAX_SPARKS = 18;
export const SPARK_RATE = 5.5;

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

export interface StackDot {
  x: number;
  y: number;
  z: number;
  nx: number;
  ny: number;
  nz: number;
  a: number;
  s: number;
  plate: number;
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

/** Camera position in world space, derived from the projection: the scene is
 *  tilted about X then pushed back by `CAM_DIST`, so the eye sits above and
 *  behind the origin. Needed for occlusion. */
const CAMERA = {
  x: 0,
  y: -CAM_DIST * Math.sin(TILT),
  z: -CAM_DIST * Math.cos(TILT),
};

/** Squircle test in a plate's local xz, normalised so 1 is exactly the edge. */
function insidePlate(x: number, z: number, r: number) {
  return Math.abs(x / r) ** SQ_P + Math.abs(z / r) ** SQ_P;
}

/**
 * True when the straight line from this dot to the eye passes through a plate
 * above it. Without this the tiers are transparent — every lower face shows
 * through the one stacked on it, which is exactly what turns the stack to mush.
 * Evaluated once at build time; the top plate's deploy lift is far too small to
 * change any answer.
 */
function occluded(x: number, y: number, z: number, above: readonly { r: number; top: number; bottom: number }[]) {
  for (const plate of above) {
    const dy = CAMERA.y - y;
    if (Math.abs(dy) < 1e-6) continue;
    const t1 = (plate.top - y) / dy;
    const t2 = (plate.bottom - y) / dy;
    const lo = Math.max(0.001, Math.min(t1, t2));
    const hi = Math.min(1, Math.max(t1, t2));
    if (hi <= lo) continue;
    for (let k = 0; k <= 4; k++) {
      const t = lo + ((hi - lo) * k) / 4;
      const px = x + (CAMERA.x - x) * t - STACK_X;
      const pz = z + (CAMERA.z - z) * t - STACK_Z;
      if (insidePlate(px, pz, plate.r) <= 1) return true;
    }
  }
  return false;
}

/**
 * Surfaces of the stack: a dot lattice on each top face, plus a dense outline
 * ring at each plate's upper and lower edge.
 *
 * Two things keep it crisp rather than hairy. The face grid is *anisotropic* —
 * rows are spaced by `1/sin(tilt)` more than columns — so after the camera
 * squashes the disc the dots land on a roughly square grid on screen instead of
 * smearing into streaks. And every dot is occlusion-tested against the plates
 * above it, so each tier reads as a solid object with its own silhouette.
 */
export function buildStack(): StackDot[] {
  const dots: StackDot[] = [];
  const sinT = Math.sin(TILT);

  PLATES.forEach((plate, index) => {
    const above = PLATES.slice(index + 1);
    // Pitch tightens on the smaller upper tiers so each one still carries a
    // readable grid rather than three lonely rows.
    const stepX = 0.075 * (0.55 + 0.45 * plate.r);
    const stepZ = (stepX / sinT) * 0.78;

    // ── Top face ──
    for (let x = -plate.r; x <= plate.r + 1e-9; x += stepX) {
      for (let z = -plate.r; z <= plate.r + 1e-9; z += stepZ) {
        if (insidePlate(x, z, plate.r) > 1) continue;
        const wx = STACK_X + x;
        const wz = STACK_Z + z;
        if (occluded(wx, plate.top, wz, above)) continue;
        dots.push({
          x: wx,
          y: plate.top,
          z: wz,
          nx: 0,
          ny: -1,
          nz: 0,
          // Higher tiers read brighter — the cheapest way to keep three stacked
          // discs from flattening into one mass.
          a: 0.62 + index * 0.13,
          s: 1,
          plate: index,
        });
      }
    }

    // ── Edge rings: the crisp silhouette of each tier ──
    const ringSteps = 132;
    for (let i = 0; i < ringSteps; i++) {
      const t = (i / ringSteps) * TAU;
      const ct = Math.cos(t);
      const st = Math.sin(t);
      const x = plate.r * Math.sign(ct) * Math.abs(ct) ** (2 / SQ_P);
      const z = plate.r * Math.sign(st) * Math.abs(st) ** (2 / SQ_P);
      const gx = x ** (SQ_P - 1);
      const gz = z ** (SQ_P - 1);
      const gl = Math.hypot(gx, gz) || 1;
      for (const y of [plate.top, plate.bottom]) {
        const wx = STACK_X + x;
        const wz = STACK_Z + z;
        if (occluded(wx, y, wz, above)) continue;
        dots.push({
          x: wx,
          y,
          z: wz,
          // The upper ring reads as the face's edge, the lower as the plate's
          // underside, so they take different normals.
          nx: gx / gl,
          ny: y === plate.top ? -0.35 : 0.2,
          nz: gz / gl,
          a: (y === plate.top ? 0.95 : 0.6) + index * 0.03,
          s: y === plate.top ? 1.05 : 0.9,
          plate: index,
        });
      }
    }
  });

  return dots;
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

/** Rise-then-settle curve for the top plate as the deploy hands over. */
export function plateLift(t: number) {
  const phase = t % WAVE_CYCLE;
  if (phase >= LIFT_DURATION) return 0;
  const u = phase / LIFT_DURATION;
  const rise = 1 - (1 - Math.min(1, u / 0.18)) ** 4;
  const settle = u <= 0.18 ? 0 : ((u - 0.18) / 0.82) ** 2;
  return -LIFT_MAX * Math.max(0, rise - settle);
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
