/**
 * Row density.
 *
 * Its own module because three things need it and none of them should have to
 * import the row renderer to get it: the view (which measures rows), the
 * preference store (which persists the choice), and the view-options menu
 * (which offers it). One list of densities, one height per density — the
 * virtualizer's arithmetic is exact only while those two agree.
 */

/**
 * Fixed row heights, in px. Uniform rows are what keep the virtualizer exact.
 *
 * Tuned down with the type scale (13px body, 12px mono): a row sized for 14px
 * text around 12px text is padding pretending to be density, and this table is
 * read a hundred rows at a time.
 */
export const ROW_HEIGHT = { compact: 28, comfortable: 34 } as const;

export type Density = keyof typeof ROW_HEIGHT;

export const DEFAULT_DENSITY: Density = "comfortable";
