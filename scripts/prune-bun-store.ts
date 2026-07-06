// Garbage-collect bun's content store (node_modules/.bun) down to what the two
// runtime roles (server bundle + builder worker) can actually load.
//
// `bun install --filter server --filter builder --production` prunes the SYMLINK
// tree correctly (no top-level vite/@cloudflare/@getworkbench), but it still
// extracts every dev-only and optional-peer package in the lockfile graph into
// node_modules/.bun and wires their intra-store peer symlinks. ~560MB rides along
// that neither role imports. It roots at two source edges:
//   - evlog (a real prod dep of @otterdeploy/api) ships framework bridges and
//     declares OPTIONAL peers `nitro` + `vite`:
//       evlog → nitro → env-runner → wrangler → miniflare → workerd (120MB)
//       evlog → vite  → vitest/rolldown/esbuild/typescript
//   - the same cluster is also reachable via @tanstack/*-start (SSR, unused
//     server-side) and root dev tooling (vite-plus).
//
// We CANNOT key off the "optional peer" flag alone: `@better-auth/drizzle-adapter`
// declares `drizzle-orm` as an optional peer too, but that one is genuinely used.
// So the only honest signal for "linked but never imported" is a denylist of the
// proven build/test/framework-bridge packages below. Everything else follows the
// full resolution closure, so real optional peers (drizzle-orm, sharp binaries, …)
// survive. Validated by booting BOTH roles after the prune.
//
// Usage: bun run scripts/prune-bun-store.ts [/app]

import { existsSync, lstatSync, readdirSync, readlinkSync, rmSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

const ROOT = resolve(process.argv[2] ?? "/app");
const STORE = join(ROOT, "node_modules", ".bun");

// Build/test/SSR-framework tooling that the server bundle (pre-built by tsdown)
// and the builder worker (runs on bun, shells out to docker/railpack) never
// import at runtime. Matched against the package NAME parsed from each store key.
// Exact names:
const DENY_NAMES = new Set([
  "nitro",
  "env-runner",
  "wrangler",
  "miniflare",
  "workerd",
  "vite",
  "vitest",
  "vite-plus",
  "vitefu",
  "oxfmt",
  "oxlint",
  "esbuild",
  "rolldown",
  "unenv",
]);
// Whole scopes that only exist to build/test the SPA or run Workers/SSR:
const DENY_SCOPES = [
  "@vitest/",
  "@esbuild/",
  "@rolldown/",
  "@cloudflare/",
  "@tanstack/react-start",
  "@tanstack/start-",
  "@typescript/", // oxc-native tsc (@typescript/typescript-*), dev-only
];

// Store key → package name, e.g. `@cloudflare+workerd-linux-64@1.2` →
// `@cloudflare/workerd-linux-64`, `vite@8.0.16+hash` → `vite`.
function keyToName(storeKey: string): string {
  const at = storeKey.lastIndexOf("@");
  const namePart = at > 0 ? storeKey.slice(0, at) : storeKey;
  return namePart.replace("+", "/");
}

function isDenied(storeKey: string): boolean {
  const name = keyToName(storeKey);
  if (DENY_NAMES.has(name)) return true;
  return DENY_SCOPES.some((s) => name.startsWith(s));
}

if (!existsSync(STORE)) {
  console.log(`[prune-bun-store] no store at ${STORE}, nothing to do`);
  process.exit(0);
}

// Resolve a symlink target to the `.bun/<pkgKey>` segment it lands in, or null
// if it points outside the store (e.g. a workspace-to-workspace link).
function storeKeyOf(linkPath: string): string | null {
  let target: string;
  try {
    target = readlinkSync(linkPath);
  } catch {
    return null;
  }
  const abs = resolve(join(linkPath, ".."), target);
  const rel = relative(STORE, abs);
  if (rel.startsWith("..") || rel.startsWith(sep) || rel === "") return null;
  const key = rel.split(sep)[0];
  return key && key.length > 0 ? key : null;
}

// Every symlink directly under a node_modules dir (handles one level of @scope).
function symlinksUnder(nmDir: string): string[] {
  const out: string[] = [];
  if (!existsSync(nmDir)) return out;
  for (const name of readdirSync(nmDir)) {
    if (name === ".bun") continue;
    const full = join(nmDir, name);
    let st;
    try {
      st = lstatSync(full);
    } catch {
      continue;
    }
    if (st.isSymbolicLink()) {
      out.push(full);
    } else if (name.startsWith("@") && st.isDirectory()) {
      for (const sub of readdirSync(full)) {
        const f2 = join(full, sub);
        try {
          if (lstatSync(f2).isSymbolicLink()) out.push(f2);
        } catch {
          /* ignore */
        }
      }
    }
  }
  return out;
}

// Find every node_modules dir in the repo tree, skipping the store itself.
function findNodeModules(dir: string, acc: string[]): string[] {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const e of entries) {
    if (!e.isDirectory() && !e.isSymbolicLink()) continue;
    if (e.name === ".git") continue;
    const full = join(dir, e.name);
    if (e.name === "node_modules") {
      acc.push(full);
      for (const sub of readdirSync(full, { withFileTypes: true })) {
        if (sub.isDirectory() && sub.name !== ".bun") {
          findNodeModules(join(full, sub.name), acc);
        }
      }
      continue;
    }
    if (e.isDirectory()) findNodeModules(full, acc);
  }
  return acc;
}

// Seed the reachable set from every real symlink outside the store, then close
// over the full intra-store resolution graph — EXCEPT denied packages, whose
// exclusive subtrees fall out of the closure and get deleted.
const reachable = new Set<string>();
const queue: string[] = [];
function visit(key: string | null) {
  if (!key || reachable.has(key) || isDenied(key)) return;
  reachable.add(key);
  queue.push(key);
}

for (const nm of findNodeModules(ROOT, [])) {
  for (const link of symlinksUnder(nm)) visit(storeKeyOf(link));
}
while (queue.length > 0) {
  const key = queue.pop()!;
  for (const link of symlinksUnder(join(STORE, key, "node_modules"))) {
    visit(storeKeyOf(link));
  }
}

// Delete every store package not in the reachable closure.
let removed = 0;
const removedKeys: string[] = [];
for (const entry of readdirSync(STORE)) {
  if (entry.startsWith(".")) continue; // keep .bin, .cache, lockmeta, etc.
  if (reachable.has(entry)) continue;
  rmSync(join(STORE, entry), { recursive: true, force: true });
  removed++;
  removedKeys.push(entry);
}

console.log(`[prune-bun-store] kept ${reachable.size} store packages, removed ${removed}`);
if (removedKeys.length > 0) {
  const notable = removedKeys
    .filter((k) =>
      /workerd|wrangler|miniflare|vite|vitest|typescript|rolldown|esbuild|nitro/.test(k),
    )
    .slice(0, 12);
  if (notable.length > 0) console.log(`[prune-bun-store] incl: ${notable.join(", ")}`);
}
