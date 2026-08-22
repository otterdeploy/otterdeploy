import { describe, expect, test } from "vite-plus/test";

import type { PkgJson, TreeSnapshot } from "../inspect-github";

import { deriveWatchPatterns } from "../watch-patterns";

/** The package reader is injected, so these tests load no db and need no
 *  module mocking — the graph walk is exercised against an in-memory repo. */
function reader(entries: Record<string, PkgJson>) {
  const registry = new Map<string, PkgJson>();
  for (const [dir, pkg] of Object.entries(entries)) registry.set(`${dir}/package.json`, pkg);
  return (path: string) => Promise.resolve(registry.get(path) ?? null);
}

function snapshot(files: string[]): TreeSnapshot {
  const pathTypes = new Map<string, "dir" | "file">();
  for (const f of files) pathTypes.set(f, "file");
  return { paths: files, pathTypes, expiresAt: Date.now() + 60_000 };
}

const ROOT_FILES = ["package.json", "turbo.json", "bun.lock"];

describe("deriveWatchPatterns", () => {
  test("covers the app, its transitive workspace deps, and the root build files", async () => {
    const patterns = await deriveWatchPatterns({
      snapshot: snapshot(ROOT_FILES),
      subdir: "apps/web",
      workspacePackages: ["apps/web", "packages/ui", "packages/core", "packages/unused"],
      readPackageJson: reader({
        "apps/web": {
          name: "@acme/web",
          dependencies: { "@acme/ui": "workspace:*", react: "^19" },
        },
        "packages/ui": { name: "@acme/ui", dependencies: { "@acme/core": "workspace:*" } },
        "packages/core": { name: "@acme/core" },
        "packages/unused": { name: "@acme/unused" },
      }),
    });

    // Two hops down (core, via ui) is included; an unrelated package is not.
    expect(patterns).toEqual([
      "apps/web/**",
      "packages/core/**",
      "packages/ui/**",
      "package.json",
      "turbo.json",
      "bun.lock",
    ]);
    expect(patterns).not.toContain("packages/unused/**");
  });

  test("registry dependencies never become patterns", async () => {
    const patterns = await deriveWatchPatterns({
      snapshot: snapshot(["package.json"]),
      subdir: "apps/web",
      workspacePackages: ["apps/web"],
      readPackageJson: reader({
        "apps/web": { name: "@acme/web", dependencies: { react: "^19", lodash: "^4" } },
      }),
    });
    expect(patterns).toEqual(["apps/web/**", "package.json"]);
  });

  test("a dependency cycle terminates instead of hanging", async () => {
    const patterns = await deriveWatchPatterns({
      snapshot: snapshot([]),
      subdir: "packages/a",
      workspacePackages: ["packages/a", "packages/b"],
      readPackageJson: reader({
        "packages/a": { name: "a", dependencies: { b: "workspace:*" } },
        "packages/b": { name: "b", dependencies: { a: "workspace:*" } },
      }),
    });
    expect(patterns).toEqual(["packages/a/**", "packages/b/**"]);
  });

  test("devDependencies count too (build-time workspace tooling)", async () => {
    const patterns = await deriveWatchPatterns({
      snapshot: snapshot([]),
      subdir: "apps/web",
      workspacePackages: ["apps/web", "packages/tsconfig"],
      readPackageJson: reader({
        "apps/web": { name: "@acme/web", devDependencies: { "@acme/tsconfig": "workspace:*" } },
        "packages/tsconfig": { name: "@acme/tsconfig" },
      }),
    });
    expect(patterns).toEqual(["apps/web/**", "packages/tsconfig/**"]);
  });

  test("an unnamed app still watches itself and the root files", async () => {
    const patterns = await deriveWatchPatterns({
      snapshot: snapshot(["package.json"]),
      subdir: "apps/web",
      workspacePackages: ["apps/web"],
      readPackageJson: reader({ "apps/web": { dependencies: {} } }),
    });
    expect(patterns).toEqual(["apps/web/**", "package.json"]);
  });

  test("the repo root itself gets no patterns (it watches everything)", async () => {
    const patterns = await deriveWatchPatterns({
      snapshot: snapshot(ROOT_FILES),
      subdir: "",
      workspacePackages: [],
      readPackageJson: reader({}),
    });
    expect(patterns).toEqual([]);
  });

  test("only lockfiles that actually exist are listed", async () => {
    const patterns = await deriveWatchPatterns({
      snapshot: snapshot(["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml"]),
      subdir: "apps/web",
      workspacePackages: ["apps/web"],
      readPackageJson: reader({ "apps/web": { name: "w" } }),
    });
    expect(patterns).toEqual([
      "apps/web/**",
      "package.json",
      "pnpm-workspace.yaml",
      "pnpm-lock.yaml",
    ]);
    expect(patterns).not.toContain("bun.lock");
  });
});
