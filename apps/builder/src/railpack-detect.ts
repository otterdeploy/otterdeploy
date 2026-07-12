/**
 * Source-tree inspection for railpack builds — read the build context to decide
 * the package manager, whether the repo is a workspace, and whether a single-app
 * build needs its start command forced (TanStack Start misdetection). Split out
 * of railpack.ts so that file stays within the size + complexity budgets.
 */

import { access, readFile } from "node:fs/promises";
import { join } from "node:path";

import type { LogSink } from "./log-stream";

/** Deps that mark a TanStack Start SSR app (react / solid variants + the meta
 *  package). These build to `.output/` via Nitro, but railpack's Node provider
 *  sees `vite build` and mis-detects a static SPA — presence of one of these
 *  plus a `start` script is the signal to force a server deploy instead. */
const TANSTACK_START_PACKAGES = [
  "@tanstack/react-start",
  "@tanstack/solid-start",
  "@tanstack/start",
];

/** Read + JSON.parse a file, returning null on any error (missing/malformed). */
export async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch {
    return null;
  }
}

export async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** True when the repo root declares a package workspace — npm/yarn/bun via the
 *  `workspaces` field (string[] or bun's `{ packages: [] }`), pnpm via
 *  pnpm-workspace.yaml. This is the signal that a subdir service must build from
 *  the root so its lockfile, catalog, and sibling packages resolve. */
export async function rootIsWorkspace(workDir: string): Promise<boolean> {
  const pkg = await readJson<{ workspaces?: unknown }>(join(workDir, "package.json"));
  const ws = pkg?.workspaces;
  if (Array.isArray(ws) && ws.length > 0) return true;
  if (ws && typeof ws === "object" && "packages" in ws && Array.isArray(ws.packages)) {
    return true;
  }
  return fileExists(join(workDir, "pnpm-workspace.yaml"));
}

/** The `<pm> run` prefix used to invoke an app's scripts, derived from the
 *  `packageManager` field then lockfile presence. npm/bun/pnpm/yarn all accept
 *  `<pm> run <script>`. */
export async function detectPackageManagerRun(workDir: string): Promise<string> {
  const pkg = await readJson<{ packageManager?: string }>(join(workDir, "package.json"));
  const declared = pkg?.packageManager?.split("@")[0]?.trim();
  if (declared === "bun" || declared === "pnpm" || declared === "yarn" || declared === "npm") {
    return `${declared} run`;
  }
  if (
    (await fileExists(join(workDir, "bun.lock"))) ||
    (await fileExists(join(workDir, "bun.lockb")))
  ) {
    return "bun run";
  }
  if (await fileExists(join(workDir, "pnpm-lock.yaml"))) return "pnpm run";
  if (await fileExists(join(workDir, "yarn.lock"))) return "yarn run";
  return "npm run";
}

/** For a single-app (non-workspace) build, the start command to hand railpack
 *  when the app looks like TanStack Start — else null. TanStack Start is SSR
 *  (Nitro) and builds to `.output/`, but railpack's Node provider mis-detects it
 *  as a static "vite" site and bakes a `COPY /app/dist` that never exists, so the
 *  build dies. Handing railpack an explicit `--start-cmd` forces a server deploy
 *  instead. Returns null when the app is a declared SPA (genuinely static), isn't
 *  TanStack Start, or declares no `start` script — nothing to force. */
export async function tanstackStartCommand(
  appDir: string,
  spaOutputDir: string | null,
  sink: LogSink,
): Promise<string | null> {
  if (spaOutputDir) return null;
  const pkg = await readJson<{
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    scripts?: Record<string, string>;
  }>(join(appDir, "package.json"));
  if (!pkg?.scripts?.start) return null;
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  if (!TANSTACK_START_PACKAGES.some((p) => p in deps)) return null;
  const cmd = `${await detectPackageManagerRun(appDir)} start`;
  sink.system(`detected TanStack Start — deploying as a server (start="${cmd}")`);
  return cmd;
}
