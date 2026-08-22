import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { rootTsconfigIsReferenced, unsafeDroppedRootFiles } from "../turbo-prune";

const tmpDirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "otter-prune-test-"));
  tmpDirs.push(dir);
  return dir;
}

function writeFile(dir: string, rel: string, contents: string): void {
  const path = join(dir, rel);
  mkdirSync(resolve(path, ".."), { recursive: true });
  writeFileSync(path, contents);
}

afterEach(() => {
  while (tmpDirs.length) {
    const dir = tmpDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

/** What `turbo prune` actually leaves at the root of its output. */
const PRUNED_ROOT = ["apps", "packages", "bun.lock", "package.json", "turbo.json", ".gitignore"];

describe("unsafeDroppedRootFiles", () => {
  test("a repo whose shared config lives in a workspace package is prunable", () => {
    // otterdeploy's own shape, measured 2026-08-21: packages extend
    // @otterdeploy/config, so nothing build-relevant sits at the root.
    const original = [
      "apps",
      "packages",
      "bun.lock",
      "package.json",
      "turbo.json",
      ".gitignore",
      ".dockerignore",
      "README.md",
      "LICENSE",
      "CLAUDE.md",
      "docker-compose.yml",
    ];
    expect(unsafeDroppedRootFiles(original, PRUNED_ROOT)).toEqual([]);
  });

  test("a root tsconfig.json blocks pruning — packages extend it via ../..", () => {
    const original = [...PRUNED_ROOT, "tsconfig.json"];
    expect(unsafeDroppedRootFiles(original, PRUNED_ROOT)).toEqual(["tsconfig.json"]);
  });

  test("a root .npmrc blocks pruning — private registry auth breaks install", () => {
    expect(unsafeDroppedRootFiles([...PRUNED_ROOT, ".npmrc"], PRUNED_ROOT)).toEqual([".npmrc"]);
  });

  test("shared tool config at the root blocks pruning", () => {
    const original = [
      ...PRUNED_ROOT,
      "tailwind.config.ts",
      "postcss.config.js",
      "vitest.config.mts",
    ];
    expect(unsafeDroppedRootFiles(original, PRUNED_ROOT).sort()).toEqual([
      "postcss.config.js",
      "tailwind.config.ts",
      "vitest.config.mts",
    ]);
  });

  test("yarn PnP, patches, and toolchain pins all block pruning", () => {
    for (const name of [".yarn", ".pnp.cjs", "patches", ".nvmrc", ".tool-versions"]) {
      expect(unsafeDroppedRootFiles([...PRUNED_ROOT, name], PRUNED_ROOT)).toEqual([name]);
    }
  });

  test("non-JS toolchains at the root block pruning too", () => {
    for (const name of ["go.mod", "Cargo.toml", "requirements.txt", "Makefile"]) {
      expect(unsafeDroppedRootFiles([...PRUNED_ROOT, name], PRUNED_ROOT)).toEqual([name]);
    }
  });

  test("VCS, editor, CI and docs metadata are never treated as build inputs", () => {
    const noise = [
      ".git",
      ".github",
      ".gitattributes",
      ".dockerignore",
      ".vscode",
      ".idea",
      ".claude",
      "README.md",
      "LICENSE",
      "CHANGELOG.md",
      ".DS_Store",
      "node_modules",
    ];
    expect(unsafeDroppedRootFiles([...PRUNED_ROOT, ...noise], PRUNED_ROOT)).toEqual([]);
  });

  test("a file kept by prune is never reported, even when build-relevant", () => {
    const withTsconfig = [...PRUNED_ROOT, "tsconfig.json"];
    expect(unsafeDroppedRootFiles(withTsconfig, withTsconfig)).toEqual([]);
  });

  test("an unrecognised root file does not block pruning", () => {
    // Only plausibly-build-relevant names gate. A stray file shouldn't cost
    // every prunable repo its optimisation.
    expect(unsafeDroppedRootFiles([...PRUNED_ROOT, "NOTES.txt", "scratch"], PRUNED_ROOT)).toEqual(
      [],
    );
  });
});

describe("rootTsconfigIsReferenced", () => {
  test("a package extending ../../tsconfig.json makes the root file load-bearing", async () => {
    const dir = tempDir();
    writeFile(dir, "apps/web/tsconfig.json", JSON.stringify({ extends: "../../tsconfig.json" }));
    expect(await rootTsconfigIsReferenced(dir)).toBe(true);
  });

  test("extending a workspace package resolves through node_modules, so the root file is inert", async () => {
    // otterdeploy's real shape, measured 2026-08-21.
    const dir = tempDir();
    writeFile(
      dir,
      "apps/server/tsconfig.json",
      JSON.stringify({ extends: "@otterdeploy/config/tsconfig.base.json" }),
    );
    writeFile(
      dir,
      "packages/api/tsconfig.json",
      JSON.stringify({ extends: "@otterdeploy/config/tsconfig.base.json" }),
    );
    expect(await rootTsconfigIsReferenced(dir)).toBe(false);
  });

  test("a package with no extends at all does not pin the root file", async () => {
    const dir = tempDir();
    writeFile(dir, "apps/web/tsconfig.json", JSON.stringify({ compilerOptions: { strict: true } }));
    expect(await rootTsconfigIsReferenced(dir)).toBe(false);
  });

  test("the array form of extends is checked element by element", async () => {
    const dir = tempDir();
    writeFile(
      dir,
      "apps/web/tsconfig.json",
      JSON.stringify({ extends: ["@acme/config/base.json", "../../tsconfig.base.json"] }),
    );
    expect(await rootTsconfigIsReferenced(dir)).toBe(true);
  });

  test("comments and trailing commas parse (tsconfig is JSONC, not JSON)", async () => {
    const dir = tempDir();
    writeFile(
      dir,
      "apps/web/tsconfig.json",
      '{\n  // the shared base\n  "extends": "@acme/config/base.json", /* inline */\n}\n',
    );
    expect(await rootTsconfigIsReferenced(dir)).toBe(false);
  });

  test("a URL-ish string containing // is not mistaken for a comment", async () => {
    const dir = tempDir();
    writeFile(
      dir,
      "apps/web/tsconfig.json",
      JSON.stringify({
        extends: "../../base.json",
        $schema: "https://json.schemastore.org/tsconfig",
      }),
    );
    expect(await rootTsconfigIsReferenced(dir)).toBe(true);
  });

  test("an unreadable or malformed tsconfig errs toward keeping the root file", async () => {
    const dir = tempDir();
    writeFile(dir, "apps/web/tsconfig.json", "{ this is not json");
    expect(await rootTsconfigIsReferenced(dir)).toBe(true);
  });

  test("a tree with no package tsconfigs at all leaves the root file droppable", async () => {
    expect(await rootTsconfigIsReferenced(tempDir())).toBe(false);
  });
});

describe("unsafeDroppedRootFiles — tsconfig gating", () => {
  const pruned = ["apps", "packages", "package.json", "bun.lock", "turbo.json"];

  test("a referenced root tsconfig blocks pruning", () => {
    expect(unsafeDroppedRootFiles([...pruned, "tsconfig.json"], pruned, true)).toEqual([
      "tsconfig.json",
    ]);
  });

  test("an unreferenced root tsconfig does not", () => {
    expect(unsafeDroppedRootFiles([...pruned, "tsconfig.json"], pruned, false)).toEqual([]);
  });

  test("the tsconfig verdict does not excuse other root config", () => {
    expect(unsafeDroppedRootFiles([...pruned, "tsconfig.json", ".npmrc"], pruned, false)).toEqual([
      ".npmrc",
    ]);
  });
});
