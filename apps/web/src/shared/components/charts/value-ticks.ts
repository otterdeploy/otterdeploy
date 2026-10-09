/**
 * Y ticks for a count.
 *
 * A linear scale ticks wherever its arithmetic lands, which for a count of
 * visitors with a maximum of 0 or 1 is `0 · 0.2 · 0.4 · 0.6 · 0.8 · 1`: five
 * fractions of a person. A count axis ticks on whole numbers, and its top is a
 * whole step above the data, so the highest tick is a number the series could
 * actually reach.
 */

/** The smallest 1·2·5×10ⁿ step that is at least `raw`, and never below 1. */
function wholeStep(raw: number): number {
  if (!(raw > 1)) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  for (const factor of [1, 2, 5, 10]) {
    const step = factor * magnitude;
    if (step >= raw) return step;
  }
  return 10 * magnitude;
}

export interface CountTicks {
  /** 0, step, 2·step … top. */
  values: number[];
  /** The axis maximum: the first whole step at or above the data. */
  top: number;
}

/**
 * Whole-number ticks from 0 to just above `maxValue`, about `count` of them.
 * An all-zero series still gets a readable axis, 0 to 1, rather than a
 * collapsed one.
 */
export function countTicks(maxValue: number, count = 4): CountTicks {
  const max = Number.isFinite(maxValue) && maxValue > 0 ? maxValue : 0;
  const step = wholeStep(max / Math.max(1, count));
  const top = Math.max(step, Math.ceil(max / step) * step);
  const values: number[] = [];
  for (let value = 0; value <= top; value += step) values.push(value);
  return { values, top };
}
