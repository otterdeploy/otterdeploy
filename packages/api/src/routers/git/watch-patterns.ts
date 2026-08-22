/**
 * Watch-pattern derivation for a service inside a workspace.
 *
 * Its own module, deliberately: this is a pure graph walk over package.json
 * contents, and it must stay importable without loading the db. `inspect-derive`
 * imports `fetchPackageJson` (a value) from `inspect-github`, which reaches
 * `@otterdeploy/db` and validates DATABASE_URL at module load, so living there
 * would make a unit test of this walk require a database. Only TYPES are
 * imported here; those erase at runtime.
 */

import type { PkgJson, TreeSnapshot } from "./inspect-github";

/**
 * Suggested `watchPatterns` for a service living in a workspace subdirectory.
 *
 * Watch patterns are enforced from the push webhook's changed-file list alone
 * (see git/watch-match.ts) — there is no clone at that point, so turbo cannot
 * compute the affected set there. But the dependency graph IS knowable here,
 * from package.jsons we already fetch for the wizard, so the patterns can be
 * derived once instead of hand-written.
 *
 * The result covers: the app's own directory, the directory of every workspace
 * package it depends on (transitively — a change two hops down still rebuilds),
 * and the root files that change how anything builds (lockfile, turbo.json,
 * workspace manifest). Without the transitive walk a shared `packages/core`
 * edit would silently skip the rebuild, which is the failure mode that makes
 * people distrust watch patterns and turn them off.
 */
export async function deriveWatchPatterns(opts: {
  snapshot: TreeSnapshot;
  subdir: string;
  workspacePackages: string[];
  /** Reads one repo-relative package.json. Injected rather than imported so
   *  this stays a pure graph walk: the real reader lives in inspect-github and
   *  pulls in the db, which a unit test has no business loading. */
  readPackageJson: (path: string) => Promise<PkgJson | null>;
}): Promise<string[]> {
  const { snapshot, subdir, workspacePackages, readPackageJson } = opts;
  if (!subdir) return [];

  // name → directory, for every workspace package in the repo.
  const dirByName = new Map<string, string>();
  const namesByDir = new Map<string, string>();
  for (const dir of workspacePackages) {
    const pkg = await readPackageJson(`${dir}/package.json`);
    const name = pkg?.name?.trim();
    if (!name) continue;
    dirByName.set(name, dir);
    namesByDir.set(dir, name);
  }

  const selfName = namesByDir.get(subdir);
  if (!selfName) return [`${subdir}/**`, ...rootWatchFiles(snapshot)];

  // Breadth-first over workspace dependencies. `visited` doubles as the result
  // set and the cycle guard (workspace graphs can and do contain cycles).
  const visited = new Set<string>([selfName]);
  const queue = [selfName];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) break;
    const dir = dirByName.get(current);
    if (!dir) continue;
    const pkg = await readPackageJson(`${dir}/package.json`);
    const deps = { ...pkg?.dependencies, ...pkg?.devDependencies };
    for (const dep of Object.keys(deps)) {
      // Only workspace-internal deps have a directory; registry deps don't.
      if (!dirByName.has(dep) || visited.has(dep)) continue;
      visited.add(dep);
      queue.push(dep);
    }
  }

  const dirs = [...visited].map((n) => dirByName.get(n)).filter((d) => d !== undefined);
  return [...dirs.sort().map((d) => `${d}/**`), ...rootWatchFiles(snapshot)];
}

/** Root files that change how every package builds, so a touch on one should
 *  rebuild regardless of which app changed. Only those actually present. */
function rootWatchFiles(snapshot: TreeSnapshot): string[] {
  const candidates = [
    "package.json",
    "turbo.json",
    "pnpm-workspace.yaml",
    "bun.lock",
    "bun.lockb",
    "pnpm-lock.yaml",
    "package-lock.json",
    "yarn.lock",
  ];
  return candidates.filter((f) => snapshot.pathTypes.get(f) === "file");
}
