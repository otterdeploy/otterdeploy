/**
 * Package-manager pinning for railpack builds.
 *
 * Rewrites the repo's `packageManager` field before railpack reads it — the one
 * lever that works across every manager: bun resolves its version from
 * `packageManager` via mise, while pnpm/yarn/npm are installed by Corepack,
 * which reads the same field directly. An env override (RAILPACK_PACKAGES) only
 * reaches the bun/mise path, not Corepack, so we rewrite the field itself.
 */

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { LogSink } from "./log-stream";

/** Lowest bun version we'll build with. bun 1.3.1 (and earlier 1.3.x) abort
 *  `bun install` on Linux ARM64 while building optional native deps
 *  (msgpackr-extract via node-gyp-build-optional-packages); 1.3.13 fixed it.
 *  A repo pinning an older bun is transparently bumped to this floor so the
 *  deploy doesn't fail on a known-broken upstream release. An explicit
 *  `override` always wins over this. */
const MIN_BUN_VERSION = "1.3.13";

/**
 * Rewrite the repo's `packageManager` field so railpack/Corepack install a
 * known-good toolchain instead of whatever the repo declared. Rewrites the
 * `package.json` in the build dir — the one railpack actually reads (the
 * service's subdir for a monorepo, else the clone root).
 *
 * Resolution (see `resolvePackageManager`):
 *   1. explicit `override` (UI / manifest) always wins — the escape hatch.
 *   2. else auto-bump a bun pin below MIN_BUN_VERSION to the floor.
 *   3. else leave the repo's field untouched.
 *
 * No-ops when nothing needs changing or there's no `package.json` there. The
 * clone is an ephemeral tmpfs dir, so this never touches the user's repo.
 */
export async function applyPackageManager(
  buildDir: string,
  override: string | null | undefined,
  sink: LogSink,
): Promise<void> {
  const pkgPath = join(buildDir, "package.json");
  let raw: string;
  try {
    raw = await readFile(pkgPath, "utf8");
  } catch {
    const explicit = override?.trim();
    if (explicit) {
      sink.system(`packageManager override "${explicit}" skipped — no root package.json`);
    }
    return;
  }

  const pkg = JSON.parse(raw) as { packageManager?: string };
  const previous = pkg.packageManager;
  const pinned = resolvePackageManager(override, previous, sink);
  if (!pinned || pinned === previous) return;

  pkg.packageManager = pinned;
  await writeFile(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
  sink.system(`pinned packageManager ${previous ?? "(unset)"} → ${pinned}`);
}

/**
 * Decide the `packageManager` value to build with. Returns the new value, or
 * null to leave the repo's field as-is. See `applyPackageManager` for the order.
 */
function resolvePackageManager(
  override: string | null | undefined,
  current: string | undefined,
  sink: LogSink,
): string | null {
  const explicit = override?.trim();
  if (explicit) return explicit;

  // Auto-heal: only bun is known to ship a broken release we must dodge.
  // `packageManager` is always `<name>@<version>(+<hash>)?`.
  if (!current) return null;
  const [name, versionSpec] = current.split("@");
  if (name !== "bun" || !versionSpec) return null;

  const version = versionSpec.split(/[+-]/)[0] ?? versionSpec;
  if (compareVersions(version, MIN_BUN_VERSION) >= 0) return null;

  sink.system(
    `repo pins bun@${version} — below the supported floor; building with bun@${MIN_BUN_VERSION}`,
  );
  return `bun@${MIN_BUN_VERSION}`;
}

/** Compare dotted numeric versions (`1.3.1` vs `1.3.13`). Returns <0 / 0 / >0.
 *  Ignores any `+build` / `-prerelease` suffix — enough for the bun floor. */
function compareVersions(a: string, b: string): number {
  const parts = (v: string) =>
    (v.split(/[+-]/)[0] ?? v).split(".").map((n) => Number.parseInt(n, 10) || 0);
  const av = parts(a);
  const bv = parts(b);
  for (let i = 0; i < Math.max(av.length, bv.length); i++) {
    const diff = (av[i] ?? 0) - (bv[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}
