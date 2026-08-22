/**
 * Categorical colour for charts.
 *
 * The greyscale ramp (`--chart-1..5`) is right for a single series: one line
 * does not need a hue, and giving it one is noise. It is wrong the moment a
 * chart carries categories — eight containers rendered in eight greys is not a
 * restrained chart, it is an unreadable one, and the restraint costs the reader
 * the only thing the chart exists to tell them. DESIGN.md §2 anticipates this:
 * "Data viz stays monochrome unless a category color is earned."
 *
 * A series colour is therefore never a literal. Hue carries identity;
 * saturation and lightness come from `--chart-series-s` / `--chart-series-l`,
 * which the theme redefines. A series keeps the same identity across a theme
 * switch while the theme alone decides how loud it is.
 *
 * Hues come from an evenly spaced wheel assigned AFTER sorting by magnitude, so
 * the largest contributor always lands in the same slot. Without that sort, a
 * container drifting one rank would repaint half the chart.
 */

/** Where the wheel starts. Offset off pure red so the top series reads as a
 *  considered colour rather than an alarm — red is spoken for by `--crit`. */
const HUE_ORIGIN = 210;

/**
 * Assign each label a colour from the wheel.
 *
 * `labels` is consumed in the order given: sort by magnitude before calling so
 * slot assignment is stable. Returns a plain record because that is what both
 * the chart config and the legend want.
 */
export function seriesPalette(labels: readonly string[]): Record<string, string> {
  const palette: Record<string, string> = {};
  const count = labels.length;
  if (count === 0) return palette;
  for (let i = 0; i < count; i++) {
    palette[labels[i]] = seriesColor(i, count);
  }
  return palette;
}

/** One slot on the wheel. Exported for marks that colour themselves. */
export function seriesColor(index: number, count: number): string {
  const hue = (HUE_ORIGIN + (index * 360) / Math.max(1, count)) % 360;
  return `hsl(${hue.toFixed(1)} var(--chart-series-s) var(--chart-series-l))`;
}

/**
 * The same slot, dimmed — for a series filtered out of view.
 *
 * Filtering must dim rather than remove: dropping a series changes the axis
 * domain and the height of a stack, so the shape you were reading moves while
 * you search it. Alpha keeps the geometry identical.
 */
export function dimmedSeriesColor(index: number, count: number, alpha = 0.12): string {
  const hue = (HUE_ORIGIN + (index * 360) / Math.max(1, count)) % 360;
  return `hsl(${hue.toFixed(1)} var(--chart-series-s) var(--chart-series-l) / ${alpha})`;
}

/**
 * Order labels by total magnitude, descending, so `seriesPalette` assigns
 * slots to the things that actually dominate the chart. Ties break on the
 * label so the order is deterministic across renders.
 */
export function rankSeries(totals: ReadonlyMap<string, number>): string[] {
  return [...totals.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([label]) => label);
}
