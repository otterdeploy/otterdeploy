/**
 * "Reload to merge" for the bulk .env editor.
 *
 * The editor's save was refused because the environment's variables changed
 * since it loaded them (another tab, a teammate). Re-basing the operator's
 * text onto the current set is a per-key three-way merge: `base` is the set
 * the editor loaded, `mine` is what the operator typed, `theirs` is the set
 * saved now.
 *
 *   mine unchanged from base  -> theirs (keeps the other writer's add, edit
 *                                or delete)
 *   theirs unchanged from base -> mine
 *   both changed              -> mine (the operator sees it before saving)
 *
 * Order follows the operator's text, then keys only the other writer added.
 */

import { parseDotEnv } from "./variables-dotenv";

export function mergeEnvText(
  baseText: string,
  mineText: string,
  theirs: ReadonlyArray<{ key: string; value: string }>,
): string {
  const base = new Map(parseDotEnv(baseText).map((v) => [v.key, v.value]));
  const mineVars = parseDotEnv(mineText);
  const mine = new Map(mineVars.map((v) => [v.key, v.value]));
  const theirsMap = new Map(theirs.map((v) => [v.key, v.value]));

  const resolve = (key: string): string | undefined => {
    const b = base.get(key);
    const m = mine.get(key);
    if (m === b) return theirsMap.get(key);
    return m;
  };

  const lines: string[] = [];
  const emitted = new Set<string>();
  const emit = (key: string) => {
    if (emitted.has(key)) return;
    emitted.add(key);
    const value = resolve(key);
    if (value !== undefined) lines.push(`${key}=${value}`);
  };
  for (const v of mineVars) emit(v.key);
  for (const v of theirs) emit(v.key);
  return lines.join("\n");
}
