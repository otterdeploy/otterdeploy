import type { ProjectId, ResourceId } from "@otterdeploy/shared/id";
import type { DeploymentId } from "@otterdeploy/shared/id";

import {
  backupDir,
  DATA_ROOT,
  projectDir,
  resourceDir,
  sourceTarballPath,
} from "@otterdeploy/shared/paths";
/**
 * `fs` operations against the host data folder (`/data/otterdeploy`). The path
 * derivation is pure and lives in `@otterdeploy/shared/paths`; the side effects
 * (create the root, guarded teardown) live here, api-side only.
 *
 * Everything degrades to a no-op when the root isn't writable (e.g. local dev
 * without `OTTERDEPLOY_DATA_DIR`), so the folder is a convenience layer, never a
 * dependency: losing it never breaks a deploy. See docs/designs/data-folder.md.
 */
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";

let availability: Promise<boolean> | null = null;

/**
 * Whether the data root exists and is writable. Memoized — created `0700` on
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
 * Remove a resource's artifact dir on delete. No-op unless the resolved path
 * sits INSIDE `DATA_ROOT` *and* ends with the `resourceId` — cheap insurance
 * against a path bug nuking the wrong tree (borrowed from Coolify's
 * `endsWith(uuid)` guard). Best-effort: never throws, so it can't fail a delete.
 */
export async function removeResourceDir(projectId: ProjectId, id: ResourceId): Promise<void> {
  if (!(await dataRootAvailable())) return;
  const dir = resolve(resourceDir(projectId, id));
  const root = resolve(DATA_ROOT);
  if (!dir.startsWith(root + sep) || !dir.endsWith(id)) return;
  await rm(dir, { recursive: true, force: true }).catch(() => undefined);
}

/**
 * Remove a project's escape-hatch dir (`projects/<projectId>/`) on delete. Same
 * `endsWith(id)` + inside-`DATA_ROOT` guard as {@link removeResourceDir}.
 * Best-effort: never throws, so it can't fail a project teardown.
 */
export async function removeProjectDir(id: ProjectId): Promise<void> {
  if (!(await dataRootAvailable())) return;
  const dir = resolve(projectDir(id));
  const root = resolve(DATA_ROOT);
  if (!dir.startsWith(root + sep) || !dir.endsWith(id)) return;
  await rm(dir, { recursive: true, force: true }).catch(() => undefined);
}

/**
 * Stage a backup archive under `backups/<projectId>/<resourceId>/<backupId>.<ext>`
 * before the (possibly off-cluster) upload — the design's landing zone,
 * inspectable if the upload then fails. Returns the path, or null when the data
 * folder isn't writable (the caller just uploads straight from memory).
 * Best-effort: a staging failure never fails the backup.
 */
export async function stageBackupArchive(input: {
  projectId: ProjectId;
  resourceId: ResourceId;
  backupId: string;
  ext: string;
  body: Buffer;
}): Promise<string | null> {
  if (!(await dataRootAvailable())) return null;
  try {
    const dir = backupDir(input.projectId, input.resourceId);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const path = join(dir, `${input.backupId}.${input.ext}`);
    await writeFile(path, input.body, { mode: 0o600 });
    return path;
  } catch {
    return null;
  }
}

/** Drop a staged backup archive after its upload lands. Guarded to inside
 *  `DATA_ROOT`; best-effort. */
export async function removeStagedBackup(path: string): Promise<void> {
  const p = resolve(path);
  if (!p.startsWith(resolve(DATA_ROOT) + sep)) return;
  await rm(p, { force: true }).catch(() => undefined);
}

/**
 * Ensure the parent dir exists and return the on-disk path where an uploaded
 * source tarball should land for a `source: "upload"` build. Returns null when
 * the data folder isn't writable — the whole feature requires the shared data
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
