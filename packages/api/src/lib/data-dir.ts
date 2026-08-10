import type { ProjectId, ResourceId } from "@otterdeploy/shared/id";
import type { DeploymentId } from "@otterdeploy/shared/id";

import { DATA_ROOT, projectDir, resourceDir, sourceTarballPath } from "@otterdeploy/shared/paths";
/**
 * `fs` operations against the host data folder (`/data/otterdeploy`). The path
 * derivation is pure and lives in `@otterdeploy/shared/paths`; the side effects
 * (create the root, guarded teardown) live here, api-side only.
 *
 * Everything degrades to a no-op when the root isn't writable (e.g. local dev
 * without `OTTERDEPLOY_DATA_DIR`), so the folder is a convenience layer, never a
 * dependency: losing it never breaks a deploy. See docs/designs/data-folder.md.
 */
import { mkdir, rm } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";

let availability: Promise<boolean> | null = null;

/**
 * Whether the data root exists and is writable. Memoized. Created `0700` on
 * first call (the tree is secret-bearing). Returns `false` (never throws) when
 * `/data` isn't writable, so callers can guard a write/cleanup without a
 * try/catch and the whole feature gracefully no-ops in dev.
 */
export function dataRootAvailable(): Promise<boolean> {
  availability ??= mkdir(DATA_ROOT, { recursive: true, mode: 0o700 })
    .then(() => true)
    .catch(() => false);
  return availability;
}

/**
 * Recursively delete `path`, but ONLY if it resolves INSIDE `DATA_ROOT` *and*
 * ends with `id`. Cheap insurance against a path bug nuking the wrong tree
 * (borrowed from Coolify's `endsWith(uuid)` guard): a derivation that returns
 * `""`, `"/"`, or someone else's directory fails one of the two checks and the
 * call becomes a no-op instead of an `rm -rf`.
 *
 * This is the ONLY guarded-delete in the codebase on purpose. It used to be
 * copy-pasted at each call site, which is how a guard quietly loses a clause.
 * Every new caller must go through here rather than re-spelling the check.
 *
 * `root + sep` (not bare `root`) is what stops `/data/otterdeploy-evil` from
 * passing as a child of `/data/otterdeploy`. Best-effort: never throws, so a
 * failed cleanup can't fail the delete that triggered it.
 */
export async function removeGuardedDir(path: string, id: string): Promise<void> {
  const dir = resolve(path);
  const root = resolve(DATA_ROOT);
  if (!dir.startsWith(root + sep) || !dir.endsWith(id)) return;
  await rm(dir, { recursive: true, force: true }).catch(() => undefined);
}

/** Remove a resource's artifact dir on delete. */
export async function removeResourceDir(projectId: ProjectId, id: ResourceId): Promise<void> {
  if (!(await dataRootAvailable())) return;
  await removeGuardedDir(resourceDir(projectId, id), id);
}

/** Remove a project's escape-hatch dir (`projects/<projectId>/`) on delete. */
export async function removeProjectDir(id: ProjectId): Promise<void> {
  if (!(await dataRootAvailable())) return;
  await removeGuardedDir(projectDir(id), id);
}

/**
 * Ensure the parent dir exists and return the on-disk path where an uploaded
 * source tarball should land for a `source: "upload"` build. Returns null when
 * the data folder isn't writable. The whole feature requires the shared data
 * dir (the same gate the git-clone path degrades under), so the caller rejects
 * the upload with a clear message rather than staging into a void. The caller
 * streams the request body into this path (with its own size cap).
 */
export async function prepareSourceTarballPath(
  projectId: ProjectId,
  deploymentId: DeploymentId,
): Promise<string | null> {
  if (!(await dataRootAvailable())) return null;
  try {
    const path = sourceTarballPath(projectId, deploymentId);
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    return path;
  } catch {
    return null;
  }
}

/** Drop a staged source tarball once the builder has consumed it (or after a
 *  failed upload). Guarded to inside `DATA_ROOT`; best-effort. */
export async function removeSourceTarball(path: string): Promise<void> {
  const p = resolve(path);
  if (!p.startsWith(resolve(DATA_ROOT) + sep)) return;
  await rm(p, { force: true }).catch(() => undefined);
}
