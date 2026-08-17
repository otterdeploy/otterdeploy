/**
 * The compose parser runs in the BROWSER as well as on the server.
 *
 * `apps/web/src/features/templates/components/template-detail-dialog.tsx`
 * imports `parseCompose` and parses a template's compose client-side to render
 * the detail view, so every module the parser reaches is bundled for the SPA.
 * A `node:` import anywhere in that graph resolves to a shim whose exports the
 * bundler cannot fill in, and the failure is a runtime TypeError in minified
 * code (`Ur.normalize is not a function`) not a build error. It took out the
 * entire template catalog dialog, not merely the feature that added the import.
 *
 * Nothing else catches this: `apps/web`'s vitest runs in `environment: "node"`,
 * where `node:path` resolves perfectly well, so the catalog test that parses
 * every shipped template stayed green while the app was broken. Hence a test on
 * the import graph itself rather than on behaviour.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vite-plus/test";

const ENTRY = resolve(import.meta.dirname, "../parse.ts");

/** Every `from "..."` specifier in a file, paired with whether it is type-only
 *  (`import type` is erased before bundling, so it cannot break a browser). */
function imports(src: string): Array<{ spec: string; typeOnly: boolean }> {
  const out: Array<{ spec: string; typeOnly: boolean }> = [];
  for (const m of src.matchAll(/import\s+(type\s+)?[^"';]*?from\s*["']([^"']+)["']/g)) {
    out.push({ spec: m[2] ?? "", typeOnly: Boolean(m[1]) });
  }
  return out;
}

/** Walk the relative-import graph from `entry`, collecting the runtime `node:`
 *  imports found along the way as `file → specifier`. */
function nodeImportsReachableFrom(entry: string): string[] {
  const seen = new Set<string>();
  const found: string[] = [];
  const visit = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    let src: string;
    try {
      src = readFileSync(file, "utf8");
    } catch {
      return; // .js/.json resolution misses, not what this test is about
    }
    for (const { spec, typeOnly } of imports(src)) {
      if (typeOnly) continue;
      if (spec.startsWith("node:")) {
        found.push(`${file.replace(/.*\/src\//, "src/")} → ${spec}`);
        continue;
      }
      if (!spec.startsWith(".")) continue;
      const base = resolve(dirname(file), spec);
      visit(base.endsWith(".ts") ? base : `${base}.ts`);
      visit(`${base}/index.ts`);
    }
  };
  visit(entry);
  return found;
}

describe("compose parser is browser-safe", () => {
  it("reaches no node: builtin", () => {
    expect(nodeImportsReachableFrom(ENTRY)).toEqual([]);
  });

  it("actually walks the graph it claims to", () => {
    // A guard on the guard: if the walker silently resolved nothing, the test
    // above would pass forever. normalize.ts is a real edge out of parse.ts.
    const src = readFileSync(ENTRY, "utf8");
    expect(imports(src).some((i) => !i.typeOnly && i.spec.includes("normalize"))).toBe(true);
  });
});
