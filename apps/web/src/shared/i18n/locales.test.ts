/**
 * Locale parity, checked at runtime.
 *
 * Key drift is primarily a *type* error now — `packages/i18n/src/types.ts`
 * derives a dotted-path union from each bundle and asserts the difference is
 * `never`, so a missing or orphaned key fails `tsc`. These tests are not
 * redundant with that:
 *
 *   - `tsc` reports the first offending key and stops. When a whole feature
 *     lands untranslated you want the entire list at once, which is what
 *     `expect(missing).toEqual([])` prints.
 *   - Placeholder and empty-value checks are beyond what the type system
 *     sees: `{{count}}` vs `{{total}}` are both just `string`.
 *
 * A missing key doesn't throw at runtime — i18next silently falls back to
 * English, so a half-translated screen ships looking fine to whoever wrote it
 * and broken to everyone else.
 */

import { describe, expect, it } from "vitest";

import en from "../../../../../packages/i18n/src/locales/en.json";
import de from "../../../../../packages/i18n/src/locales/de.json";
import es from "../../../../../packages/i18n/src/locales/es.json";

type Tree = { [key: string]: string | Tree };

/** Flatten to dotted paths so a diff names the exact missing key. */
function paths(tree: Tree, prefix = ""): string[] {
  return Object.entries(tree).flatMap(([key, value]) => {
    const path = prefix === "" ? key : `${prefix}.${key}`;
    return typeof value === "string" ? [path] : paths(value, path);
  });
}

/** `{{name}}` placeholders a string expects, in sorted order. */
function placeholders(value: string): string[] {
  return [...value.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();
}

function valueAt(tree: Tree, path: string): string | undefined {
  const found = path.split(".").reduce<string | Tree | undefined>((node, part) => {
    if (node === undefined || typeof node === "string") return undefined;
    return node[part];
  }, tree);
  return typeof found === "string" ? found : undefined;
}

const enPaths = paths(en as Tree);

/**
 * Every locale except the source of truth. Adding one here is all it takes to
 * hold it to the same bar.
 */
const translations: ReadonlyArray<{ name: string; tree: Tree }> = [
  { name: "de", tree: de as Tree },
  { name: "es", tree: es as Tree },
];

describe.each(translations)("locale parity: $name", ({ tree }) => {
  const localePaths = paths(tree);

  it("translates every English key", () => {
    const missing = enPaths.filter((path) => !localePaths.includes(path));
    expect(missing).toEqual([]);
  });

  it("defines no key English doesn't", () => {
    // A stale key is dead weight and usually means a rename landed in one
    // locale only.
    const orphaned = localePaths.filter((path) => !enPaths.includes(path));
    expect(orphaned).toEqual([]);
  });

  it("keeps the same interpolation placeholders as English", () => {
    // `{{count}}` vs `{{total}}` are both just `string` to the type system, so
    // this is the check that has to be a test.
    const mismatched = enPaths
      .map((path) => ({
        path,
        en: placeholders(valueAt(en as Tree, path) ?? ""),
        translated: placeholders(valueAt(tree, path) ?? ""),
      }))
      .filter(({ en: a, translated: b }) => a.join(",") !== b.join(","));
    expect(mismatched).toEqual([]);
  });

  it("leaves no translation empty", () => {
    const empty = localePaths.filter((path) => (valueAt(tree, path) ?? "").trim() === "");
    expect(empty).toEqual([]);
  });

  it("actually translates — a locale that is byte-identical to English is a stub", () => {
    // Guards the failure mode where a bundle is copied from English and never
    // translated: it passes every parity check above while showing English.
    // Proper nouns and machine tokens legitimately match, so this only asserts
    // that the bulk of the bundle differs.
    const identical = enPaths.filter(
      (path) => valueAt(en as Tree, path) === valueAt(tree, path),
    );
    expect(identical.length).toBeLessThan(enPaths.length / 2);
  });
});
