/**
 * Pure derivations over a cached repo tree snapshot (see inspect-github.ts):
 * folder listings, monorepo signals, workspace-package expansion, framework
 * detection, and dotenv key harvesting. Everything here reads from the snapshot
 * (or a single cached package.json read) — no extra HTTP beyond what
 * `fetchPackageJson` already memoizes.
 */
import { detectFrameworkFromPkg, type FrameworkKind } from "@otterdeploy/shared/framework";

import {
  fetchPackageJson,
  type InspectEntry,
  type MonorepoKind,
  type PkgJson,
  type RepoBinding,
  type TreeSnapshot,
} from "./inspect-github";

// Framework detection from a parsed package.json lives in
// @otterdeploy/shared/framework — the SAME heuristic the builder runs against
// the locally-cloned package.json at build time, so the wizard preview and the
// stored framework agree. `PkgJson` here is structurally compatible with the
// shared `PackageJsonLike` (it carries the dependency maps the detector reads).
const detectFromPkg = detectFrameworkFromPkg;

/** Detect monorepo signal from the cached path list — no extra HTTP. */
export function detectMonorepoFromPaths(paths: string[], rootPkg: PkgJson | null): MonorepoKind {
  const rootFiles = new Set(paths.filter((p) => !p.includes("/")));
  if (rootFiles.has("turbo.json")) return "turbo";
  if (rootFiles.has("nx.json")) return "nx";
  if (rootFiles.has("pnpm-workspace.yaml") || rootFiles.has("pnpm-workspace.yml")) {
    return "pnpm-workspace";
  }
  if (rootFiles.has("lerna.json")) return "lerna";
  if (rootPkg?.workspaces) return "yarn-workspace";
  return null;
}

/**
 * Derive direct children of `path` (single segment further down) from
 * the flat path list. No HTTP — the tree snapshot is the source of
 * truth for layout.
 */
export function listChildren(snapshot: TreeSnapshot, path: string): InspectEntry[] {
  const prefix = path === "" ? "" : `${path}/`;
  const seen = new Map<string, "dir" | "file">();
  for (const [p, type] of snapshot.pathTypes) {
    if (!p.startsWith(prefix)) continue;
    const rest = p.slice(prefix.length);
    if (!rest) continue;
    const slash = rest.indexOf("/");
    if (slash === -1) {
      // Direct child — could be either file or dir; trust pathTypes.
      seen.set(rest, type);
    } else {
      // The child is the first segment, always a dir.
      const name = rest.slice(0, slash);
      if (!seen.has(name)) seen.set(name, "dir");
    }
  }
  return [...seen.entries()]
    .map(([name, type]) => ({ name, type }))
    .sort((a, b) => {
      if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
}

export function expandWorkspacePackages(snapshot: TreeSnapshot, globs: string[]): string[] {
  const out = new Set<string>();
  const directories = new Set<string>();
  for (const [p, type] of snapshot.pathTypes) {
    if (type === "dir") directories.add(p);
  }
  for (const g of globs) {
    if (g.endsWith("/*")) {
      const base = g.slice(0, -2);
      for (const d of directories) {
        if (d.startsWith(`${base}/`) && !d.slice(base.length + 1).includes("/")) {
          out.add(d);
        }
      }
    } else {
      if (directories.has(g)) out.add(g);
    }
  }
  return [...out].sort();
}

export function collectWorkspaceGlobs(pkg: PkgJson | null): string[] {
  if (!pkg?.workspaces) return ["apps/*", "packages/*"];
  if (Array.isArray(pkg.workspaces)) return pkg.workspaces;
  return pkg.workspaces.packages ?? [];
}

export async function detectFrameworkForPath(
  binding: RepoBinding,
  snapshot: TreeSnapshot,
  path: string,
  gitRepoId: string,
): Promise<FrameworkKind> {
  const pkgPath = path ? `${path}/package.json` : "package.json";
  if (snapshot.pathTypes.get(pkgPath) === "file") {
    const pkg = await fetchPackageJson(binding, pkgPath, gitRepoId);
    const fromPkg = detectFromPkg(pkg);
    if (fromPkg && fromPkg !== "node") return fromPkg;
    // package.json says "just node" — peek at other signal files
    // BEFORE giving up, in case the repo has both (rare but possible).
  }
  // Non-Node signals — all derived from the tree snapshot, no HTTP.
  const sig = (filename: string) =>
    snapshot.pathTypes.get(path ? `${path}/${filename}` : filename) === "file";
  if (sig("go.mod")) return "go";
  if (sig("pyproject.toml") || sig("requirements.txt")) return "python";
  if (sig("Cargo.toml")) return "rust";
  if (sig("Gemfile")) return "ruby";
  // No non-Node signal — fall back to the package.json verdict if we
  // had one, even if it was just "node".
  if (snapshot.pathTypes.get(pkgPath) === "file") {
    const pkg = await fetchPackageJson(binding, pkgPath, gitRepoId);
    return detectFromPkg(pkg);
  }
  return null;
}

// Files that, if committed, leak real secrets — flagged to the operator.
export const COMMITTED_ENV_FILES = [".env", ".env.local", ".env.production"];
// Template files we harvest keys from, in precedence order.
export const ENV_TEMPLATE_FILES = [".env.example", ".env.sample", ".env.template", ".env.dist"];
const ENV_KEY_RE = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/;

/** Pull the variable names out of a dotenv-format file (values ignored). */
export function parseEnvKeys(content: string): string[] {
  const keys = new Set<string>();
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = ENV_KEY_RE.exec(line);
    if (m?.[1]) keys.add(m[1]);
  }
  return Array.from(keys);
}
