/**
 * Row model for the pre-deploy stack variables editor.
 *
 * Pure on purpose, and in its own module: the editor component imports `orpc`
 * and React, which the unit-test environment cannot resolve, so the rule this
 * file encodes would otherwise be untestable.
 */

/** A `${VAR}` the compose file references, paired with the staged value. */
export interface DraftVar {
  name: string;
  /** `${VAR:-default}` — the file's own fallback, shown as the placeholder. */
  fallback: string | null;
  value: string;
}

/**
 * Rows to render: every ref the file declares, seeded from the staged env.
 *
 * Refs come first and in file order (the order the operator reads the compose
 * in). Anything staged that the file no longer references is kept at the end
 * rather than dropped: saving rebuilds `env` from these rows, so dropping an
 * orphan here would silently delete a value the moment someone edits the
 * compose file and saves.
 */
export function buildRows(
  refs: ReadonlyArray<{ name: string; default: string | null }>,
  staged: Record<string, string>,
): DraftVar[] {
  const seen = new Set(refs.map((r) => r.name));
  const declared = refs.map((r) => ({
    name: r.name,
    fallback: r.default,
    value: staged[r.name] ?? "",
  }));
  const orphans = Object.entries(staged)
    .filter(([key]) => !seen.has(key))
    .map(([name, value]) => ({ name, fallback: null, value }));
  return [...declared, ...orphans];
}
