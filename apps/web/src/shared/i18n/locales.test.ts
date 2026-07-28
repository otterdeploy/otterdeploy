/**
 * Locale parity.
 *
 * A missing key doesn't throw at runtime — i18next silently falls back to
 * English, so a half-translated screen ships looking fine to whoever wrote it
 * and broken to everyone else. These tests turn that into a failing build.
 */

import { describe, expect, it } from "vitest";

import en from "../../../../../packages/i18n/src/locales/en.json";
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
const esPaths = paths(es as Tree);

describe("locale parity", () => {
  it("every English key has a Spanish translation", () => {
    const missing = enPaths.filter((path) => !esPaths.includes(path));
    expect(missing).toEqual([]);
  });

  it("Spanish has no keys English doesn't define", () => {
    // A stale key is dead weight and usually means a rename landed in one
    // locale only.
    const orphaned = esPaths.filter((path) => !enPaths.includes(path));
    expect(orphaned).toEqual([]);
  });

  it("interpolation placeholders match across locales", () => {
    const mismatched = enPaths
      .map((path) => ({
        path,
        en: placeholders(valueAt(en as Tree, path) ?? ""),
        es: placeholders(valueAt(es as Tree, path) ?? ""),
      }))
      .filter(({ en: a, es: b }) => a.join(",") !== b.join(","));
    expect(mismatched).toEqual([]);
  });

  it("no translation is left empty", () => {
    const empty = [...enPaths, ...esPaths].filter((path) => {
      const value = valueAt(en as Tree, path) ?? valueAt(es as Tree, path);
      return value !== undefined && value.trim() === "";
    });
    expect(empty).toEqual([]);
  });
});
