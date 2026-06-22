/**
 * Periodic reconcile of the host data folder against the DB — Phase 5 of
 * docs/designs/data-folder.md. Removes artifact dirs whose owning row is gone:
 * the failure mode Dokploy has (a crashed teardown leaves a dir forever).
 *
 * Each artifact tree is keyed by a DB id we can check:
 *   - resources/<resourceId>  → gone with its `resource` row
 *   - projects/<projectId>    → orphaned DR escape hatch (gone with its `project`)
 *   - backups/<resourceId>/   → gone with the resource; for a LIVE resource,
 *                               individual staged archives past a TTL (a failed
 *                               upload that was kept for retry) are reclaimed
 * `builds/<deploymentId>` is left to the builder's own `pruneStaleBuilds` TTL.
 *
 * Best-effort + guarded: removals go through the same `endsWith(id)` +
 * inside-`DATA_ROOT` guards as the delete paths, and the whole sweep never
 * throws (it logs and swallows), so it can't take the control plane down.
 */
import { readdir, rm, stat } from "node:fs/promises";
import { join, resolve, sep } from "node:path";

import { db } from "@otterdeploy/db";
import { project, resource } from "@otterdeploy/db/schema";
import type { ProjectId, ResourceId } from "@otterdeploy/shared/id";
import { backupDir, DATA_ROOT } from "@otterdeploy/shared/paths";
import { log as globalLog } from "evlog";

import {
  dataRootAvailable,
  removeProjectDir,
  removeResourceDir,
} from "./data-dir";

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

/** Remove a backups dir, guarded to `backups/<resourceId>` inside DATA_ROOT. */
async function removeBackupsDir(id: ResourceId): Promise<void> {
  const dir = resolve(backupDir(id));
  if (!dir.startsWith(resolve(DATA_ROOT) + sep) || !dir.endsWith(id)) return;
  await rm(dir, { recursive: true, force: true }).catch(() => undefined);
}

/** Reclaim staged archives older than the TTL inside one live resource's backups
 *  dir. Returns how many were removed. */
async function reclaimStaleStaged(id: ResourceId, now: number): Promise<number> {
  const dir = backupDir(id);
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

/**
 * One reconcile pass. Lists each artifact tree and removes dirs whose id is
 * absent from the DB. Never throws; returns the number of paths removed.
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
    for (const name of await listDirNames(join(root, "resources"))) {
      if (!resourceIds.has(name as ResourceId)) {
        await removeResourceDir(name as ResourceId);
        removed += 1;
      }
    }

    const projectIds = new Set(
      (await db.select({ id: project.id }).from(project)).map((p) => p.id),
    );
    for (const name of await listDirNames(join(root, "projects"))) {
      if (!projectIds.has(name as ProjectId)) {
        await removeProjectDir(name as ProjectId);
        removed += 1;
      }
    }

    for (const name of await listDirNames(join(root, "backups"))) {
      if (!resourceIds.has(name as ResourceId)) {
        await removeBackupsDir(name as ResourceId);
        removed += 1;
      } else {
        removed += await reclaimStaleStaged(name as ResourceId, now);
      }
    }

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
export function startDataFolderSweep(
  intervalMs = 6 * 60 * 60 * 1000,
): () => void {
  void sweepDataFolder();
  const timer = setInterval(() => {
    void sweepDataFolder();
  }, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
