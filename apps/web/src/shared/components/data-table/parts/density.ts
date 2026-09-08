/**
 * Row density.
 *
 * Its own module because three things need it and none of them should have to
 * import the row renderer to get it: the view (which measures rows), the
 * preference store (which persists the choice), and the view-options menu
 * (which offers it). One list of densities, one height per density — the
 * virtualizer's arithmetic is exact only while those two agree.
 */

/** Fixed row heights, in px. Uniform rows are what keep the virtualizer exact. */
export const ROW_HEIGHT = { compact: 32, comfortable: 38 } as const;

export type Density = keyof typeof ROW_HEIGHT;

/** In the order they are offered, tightest first. */
export const DENSITIES: readonly Density[] = ["compact", "comfortable"];

export const DEFAULT_DENSITY: Density = "comfortable";

/** Narrows an unknown stored value back to a density. */
export function isDensity(value: unknown): value is Density {
  return value === "compact" || value === "comfortable";
}
