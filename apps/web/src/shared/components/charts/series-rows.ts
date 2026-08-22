/**
 * Wide application rows → the long rows a grouped chart wants, plus the two
 * honesty rules that have to be applied while we still know the cadence.
 *
 * Our hooks all produce wide rows (`{ ts, cpuPct, memBytes, … }`) because that
 * is what the query returns and what the summary code reads. The chart grammar
 * groups by a series channel, which wants one row per series per timestamp.
 * Folding happens here, once, rather than in every call site.
 */

/** Every charted row is a point in time. */
export interface TimeRow {
  ts: number;
}

export interface LongRow {
  /** A real Date, not epoch ms: the time scale needs calendar-aware spacing,
   *  and a compact scale would treat numbers as equally spaced categories. */
  t: Date;
  series: string;
  /** Null renders as a break in the path rather than a line drawn across it. */
  value: number | null;
}

/**
 * Insert an explicit break wherever consecutive samples are further apart than
 * the sampler could have produced.
 *
 * A straight line across an outage is a measurement we never took. The window
 * is 1.5× the expected interval: tight enough to catch a missed tick, loose
 * enough that ordinary scheduling jitter does not shred the line into
 * fragments.
 *
 * Exported for the tests; `toLongRows` applies it.
 */
export function withGaps<Row extends TimeRow>(
  rows: readonly Row[],
  expectedIntervalMs: number,
): Array<Row | { ts: number; gap: true }> {
  if (expectedIntervalMs <= 0 || rows.length < 2) return [...rows];

  const threshold = expectedIntervalMs * 1.5;
  const out: Array<Row | { ts: number; gap: true }> = [];
  let previous: number | null = null;

  for (const row of rows) {
    if (previous !== null && row.ts - previous > threshold) {
      // Sits between the two real samples, so the break lands where the data
      // is actually missing rather than at either edge of it.
      out.push({ ts: previous + (row.ts - previous) / 2, gap: true });
    }
    out.push(row);
    previous = row.ts;
  }
  return out;
}

function isGap(row: object): row is { ts: number; gap: true } {
  return "gap" in row && row.gap === true;
}

/** Read one numeric field off a row without asserting the row's shape. */
function numericField(row: object, key: string): number | null {
  if (!(key in row)) return null;
  const value = Reflect.get(row, key);
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Fold wide rows into long rows, one per series per timestamp, in series-major
 * order so each path keeps chronological order within its own group.
 */
export function toLongRows<Row extends TimeRow>(
  rows: readonly Row[],
  keys: readonly { dataKey: string; label: string }[],
  expectedIntervalMs = 0,
): LongRow[] {
  const withBreaks = withGaps(rows, expectedIntervalMs);
  const long: LongRow[] = [];

  for (const { dataKey, label } of keys) {
    for (const row of withBreaks) {
      long.push({
        t: new Date(row.ts),
        series: label,
        value: isGap(row) ? null : numericField(row, dataKey),
      });
    }
  }
  return long;
}

/**
 * Total magnitude per series across the window, for ranking colour slots.
 *
 * Absolute values, so a series that swings negative (a delta metric) is ranked
 * by how much it moves rather than netting itself out to nothing.
 */
export function seriesTotals(rows: readonly LongRow[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const row of rows) {
    if (row.value === null) continue;
    totals.set(row.series, (totals.get(row.series) ?? 0) + Math.abs(row.value));
  }
  return totals;
}

/**
 * Split labels into lit and dimmed against a whitespace-separated filter.
 *
 * An empty filter lights everything. A filter matching nothing also lights
 * everything: dimming the entire chart to answer a typo is worse than ignoring
 * the typo.
 */
export function applyFilter(labels: readonly string[], filter: string): Set<string> {
  const terms = filter
    .toLowerCase()
    .split(/\s+/)
    .filter((term) => term.length > 0);
  if (terms.length === 0) return new Set(labels);

  const lit = labels.filter((label) => {
    const lower = label.toLowerCase();
    return terms.some((term) => lower.includes(term));
  });
  return new Set(lit.length > 0 ? lit : labels);
}
