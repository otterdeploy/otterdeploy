/**
 * Compose's `KEY=value` list form, parsed once.
 *
 * Several compose fields accept either a map or a list of `KEY=value` strings,
 * and half the ecosystem writes each. `environment` and `labels` both do, and
 * both had their own copy of this loop — identical down to the comment about
 * the first `=`. Two copies of a parser is two places for it to disagree about
 * an edge case, and the edge cases here are the whole job: a value containing
 * its own `=`, and a bare key.
 *
 * A LEAF on purpose: it imports nothing from this directory. `normalize.ts`
 * already imports `labels.ts`, so putting the shared helper in either of them
 * would either add an edge or restore the cycle that labels.ts was just
 * untangled from.
 */

/**
 * `["A=1", "B"]` → `{ A: "1", B: "" }`.
 *
 * Only the FIRST `=` separates, so a value may contain its own. A bare key is
 * an empty value, which is what compose itself does. Non-string entries are
 * skipped rather than coerced: a list that contains a map is author error, and
 * inventing a key for it would hide that.
 */
export function parseKeyValueList(entries: readonly unknown[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const entry of entries) {
    if (typeof entry !== "string") continue;
    const eq = entry.indexOf("=");
    if (eq === -1) out[entry] = "";
    else out[entry.slice(0, eq)] = entry.slice(eq + 1);
  }
  return out;
}
