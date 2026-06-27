import type { ProjectId, ResourceId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { project, resource } from "@otterdeploy/db/schema";
import { backupDir, DATA_ROOT } from "@otterdeploy/shared/paths";
import { log as globalLog } from "evlog";
/**
 * Periodic reconcile of the host data folder against the DB — Phase 5 of
 * docs/designs/data-folder.md. Removes artifact dirs whose owning row is gone:
 * the failure mode Dokploy has (a crashed teardown leaves a dir forever).
 *
 * Artifacts are nested under their project, so the sweep reconciles two levels:
 *   - projects/<projectId>              → orphaned DR escape hatch (project gone)
 *   - resources/<projectId>/<resourceId> → whole bucket gone with the project,
 *                                          else each child gone with its resource
 *   - backups/<projectId>/<resourceId>   → same; for a LIVE resource, staged
 *                                          archives past a TTL are reclaimed
 * `builds/<projectId>/<deploymentId>` is left to the builder's own
 * `pruneStaleBuilds` TTL.
 *
 * Best-effort + guarded: every removal re-checks the resolved path sits inside
 * `DATA_ROOT` and ends with the id it claims to be, and the whole sweep never
 * throws (it logs and swallows), so it can't take the control plane down.
 */
import { readdir, rm, stat } from "node:fs/promises";
import { join, resolve, sep } from "node:path";

import { dataRootAvailable, removeProjectDir, removeResourceDir } from "./data-dir";

/** A staged backup archive for a still-existing resource (e.g. a failed upload
 *  kept for retry) is reclaimed once it's older than this. */
const STAGED_BACKUP_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Immediate names of the subdirectories of `path` (empty on any error, e.g. the
 *  tree doesn't exist yet). */
async function listDirNames(path: string): Promise<string[]> {
  try {
    const entries = await readdir(path, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}

/** Guarded removal of a whole `<category>/<projectId>` bucket (the project
 *  itself is gone). The resolved path must sit inside `<DATA_ROOT>/<category>`
 *  and end with the projectId. */
async function removeProjectBucket(category: string, projectId: string): Promise<void> {
  const base = resolve(join(DATA_ROOT, category));
  const dir = resolve(join(base, projectId));
  if (!dir.startsWith(base + sep) || !dir.endsWith(projectId)) return;
  await rm(dir, { recursive: true, force: true }).catch(() => undefined);
}

/** Guarded removal of one resource's backups dir
 *  (`backups/<projectId>/<resourceId>`). */
async function removeBackupsDir(projectId: ProjectId, id: ResourceId): Promise<void> {
  const dir = resolve(backupDir(projectId, id));
  if (!dir.startsWith(resolve(DATA_ROOT) + sep) || !dir.endsWith(id)) return;
  await rm(dir, { recursive: true, force: true }).catch(() => undefined);
}

/** Reclaim staged archives older than the TTL inside one live resource's backups
 *  dir. Returns how many were removed. */
async function reclaimStaleStaged(
  projectId: ProjectId,
  id: ResourceId,
  now: number,
): Promise<number> {
  const dir = backupDir(projectId, id);
  let removed = 0;
  let files: string[];
  try {
    files = await readdir(dir);
  } catch {
    return 0;
  }
  for (const file of files) {
    const full = join(dir, file);
    try {
      const info = await stat(full);
      if (info.isFile() && now - info.mtimeMs > STAGED_BACKUP_TTL_MS) {
        await rm(full, { force: true }).catch(() => undefined);
        removed += 1;
      }
    } catch {
      // raced with another remover — ignore.
    }
  }
  return removed;
}

/** projects/<projectId> — orphaned DR escape hatches. Returns the number removed. */
async function reconcileProjects(root: string, projectIds: ReadonlySet<string>): Promise<number> {
  let removed = 0;
  for (const name of await listDirNames(join(root, "projects"))) {
    if (!projectIds.has(name as ProjectId)) {
      await removeProjectDir(name as ProjectId);
      removed += 1;
    }
  }
  return removed;
}

/** resources/<projectId>/<resourceId> — whole bucket when the project is gone,
 *  else each orphaned child. Returns the number removed. */
async function reconcileResources(
  root: string,
  projectIds: ReadonlySet<string>,
  resourceIds: ReadonlySet<string>,
): Promise<number> {
  let removed = 0;
  for (const projectId of await listDirNames(join(root, "resources"))) {
    if (!projectIds.has(projectId as ProjectId)) {
      await removeProjectBucket("resources", projectId);
      removed += 1;
      continue;
    }
    for (const resourceId of await listDirNames(join(root, "resources", projectId))) {
      if (!resourceIds.has(resourceId as ResourceId)) {
        await removeResourceDir(projectId as ProjectId, resourceId as ResourceId);
        removed += 1;
      }
    }
  }
  return removed;
}

/** backups/<projectId>/<resourceId> — same shape as resources; for a LIVE
 *  resource, staged archives past the TTL are reclaimed. Returns the number removed. */
async function reconcileBackups(
  root: string,
  projectIds: ReadonlySet<string>,
  resourceIds: ReadonlySet<string>,
  now: number,
): Promise<number> {
  let removed = 0;
  for (const projectId of await listDirNames(join(root, "backups"))) {
    if (!projectIds.has(projectId as ProjectId)) {
      await removeProjectBucket("backups", projectId);
      removed += 1;
      continue;
    }
    for (const resourceId of await listDirNames(join(root, "backups", projectId))) {
      if (!resourceIds.has(resourceId as ResourceId)) {
        await removeBackupsDir(projectId as ProjectId, resourceId as ResourceId);
        removed += 1;
      } else {
        removed += await reclaimStaleStaged(
          projectId as ProjectId,
          resourceId as ResourceId,
          now,
        );
      }
    }
  }
  return removed;
}

/**
 * One reconcile pass. Walks each nested artifact tree and removes dirs whose id
 * is absent from the DB (a whole project bucket when the project is gone, else
 * the individual child). Never throws; returns the number of paths removed.
 * No-ops when the data folder isn't writable.
 */
export async function sweepDataFolder(now = Date.now()): Promise<number> {
  if (!(await dataRootAvailable())) return 0;
  let removed = 0;
  try {
    const root = resolve(DATA_ROOT);

    const resourceIds = new Set(
      (await db.select({ id: resource.id }).from(resource)).map((r) => r.id),
    );
    const projectIds = new Set(
      (await db.select({ id: project.id }).from(project)).map((p) => p.id),
    );

    removed += await reconcileProjects(root, projectIds);
    removed += await reconcileResources(root, projectIds, resourceIds);
    removed += await reconcileBackups(root, projectIds, resourceIds, now);

    if (removed > 0) {
      globalLog.info({
        dataFolderSweep: { event: "reclaimed", removed },
      } as Record<string, unknown>);
    }
  } catch (cause) {
    globalLog.warn({
      dataFolderSweep: { event: "failed" },
      error: cause instanceof Error ? cause.message : String(cause),
    } as Record<string, unknown>);
  }
  return removed;
}

/**
 * Start the periodic sweep. Runs once shortly after boot (reclaim anything a
 * crashed teardown left), then on the interval. Returns a stop handle. Mirrors
 * `startBackupScheduler` — a control-plane tick, `unref`'d so it never keeps the
 * loop alive on its own.
 */
export function startDataFolderSweep(intervalMs = 6 * 60 * 60 * 1000): () => void {
  void sweepDataFolder();
  const timer = setInterval(() => {
    void sweepDataFolder();
  }, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
