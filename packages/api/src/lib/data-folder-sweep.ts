import type { EnvironmentId, OrganizationId, ProjectId } from "@otterdeploy/shared/id";
import type { ResourceRef } from "@otterdeploy/shared/paths";

import { db } from "@otterdeploy/db";
import { environment, organization, project, resource } from "@otterdeploy/db/schema";
import { idSchema } from "@otterdeploy/shared/id";
import {
  backupStagingDir,
  DATA_ROOT,
  envDir,
  envSegment,
  orgDir,
  projectDir,
} from "@otterdeploy/shared/paths";
import { log as globalLog } from "evlog";
/**
 * Periodic reconcile of the host data folder against the DB — Phase 5 of
 * docs/designs/data-folder.md. Removes tenant dirs whose owning row is gone:
 * the failure mode Dokploy has (a crashed teardown leaves a dir forever).
 *
 * The tenant tree mirrors the DB hierarchy, so the sweep reconciles each level
 * against its table, top-down:
 *
 *   orgs/<orgId>                            → organization
 *     projects/<projectId>                  → project
 *       envs/<envId|main>                   → environment ("main" is the NULL
 *                                             environment — ALWAYS kept)
 *         resources/<resourceId>            → resource; inside a LIVE resource,
 *                                             staged files in backup-staging/
 *                                             past a TTL are reclaimed
 *   work/sources/<projectId>                → orphaned upload buckets for
 *                                             deleted projects
 *
 * `work/builds/…` is left to the builder's own `pruneStaleBuilds` TTL, and
 * `platform/` and `cache/` are NEVER touched here (load-bearing and
 * builder-owned respectively).
 *
 * Best-effort + guarded: every removal goes through the guarded removers in
 * ./data-dir (resolved path inside `DATA_ROOT`, ends with the id it claims to
 * be), and the whole sweep never throws (it logs and swallows), so it can't
 * take the control plane down.
 */
import { readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";

import {
  dataRootAvailable,
  removeEnvDir,
  removeGuardedDir,
  removeOrgDir,
  removeProjectDir,
  removeResourceDir,
} from "./data-dir";

/** A staged backup dump for a still-existing resource (e.g. a failed upload
 *  kept for retry) is reclaimed once it's older than this. */
const STAGED_BACKUP_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** The ids currently present in the DB, one set per reconciled level. Plain
 *  string sets — membership checks compare directory names. */
interface LiveIds {
  orgs: ReadonlySet<string>;
  projects: ReadonlySet<string>;
  environments: ReadonlySet<string>;
  resources: ReadonlySet<string>;
}

/** Immediate names of the subdirectories of `path` (empty on any error, e.g.
 *  the tree doesn't exist yet). */
async function listDirNames(path: string): Promise<string[]> {
  try {
    const entries = await readdir(path, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}

/**
 * Brand a directory name as an id via its schema, refusing anything the
 * parse would rewrite (a legacy-prefixed name can't round-trip back to the
 * on-disk path). Returns null for names that aren't ours — the sweep leaves
 * unknown dirs alone rather than guessing.
 */
function parseDirId<T extends string>(
  schema: { safeParse: (v: string) => { success: boolean; data?: T } },
  name: string,
): T | null {
  const parsed = schema.safeParse(name);
  return parsed.success && parsed.data === name ? parsed.data : null;
}

/** Reclaim staged files older than the TTL inside one live resource's
 *  `backup-staging/` dir. Returns how many were removed. */
async function reclaimStaleStaged(dir: string, now: number): Promise<number> {
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

/** `…/envs/<seg>/resources/<resourceId>` — each orphaned resource goes; a live
 *  one gets its backup-staging TTL pass. Returns the number removed. */
async function reconcileResources(
  organizationId: OrganizationId,
  projectId: ProjectId,
  environmentId: EnvironmentId | null,
  live: LiveIds,
  now: number,
): Promise<number> {
  let removed = 0;
  const base = join(envDir(organizationId, projectId, environmentId), "resources");
  for (const name of await listDirNames(base)) {
    const resourceId = parseDirId(idSchema.resource, name);
    if (!resourceId) continue;
    const ref: ResourceRef = { organizationId, projectId, environmentId, resourceId };
    if (!live.resources.has(name)) {
      await removeResourceDir(ref);
      removed += 1;
    } else {
      removed += await reclaimStaleStaged(backupStagingDir(ref), now);
    }
  }
  return removed;
}

/** `…/projects/<projectId>/envs/<seg>` — the literal `main` segment (the NULL
 *  environment) is ALWAYS kept; any other segment reconciles against the
 *  environment table. Returns the number removed. */
async function reconcileEnvs(
  organizationId: OrganizationId,
  projectId: ProjectId,
  live: LiveIds,
  now: number,
): Promise<number> {
  let removed = 0;
  for (const name of await listDirNames(join(projectDir(organizationId, projectId), "envs"))) {
    if (name === envSegment(null)) {
      removed += await reconcileResources(organizationId, projectId, null, live, now);
      continue;
    }
    const environmentId = parseDirId(idSchema.environment, name);
    if (!environmentId) continue;
    if (!live.environments.has(name)) {
      await removeEnvDir(organizationId, projectId, environmentId);
      removed += 1;
      continue;
    }
    removed += await reconcileResources(organizationId, projectId, environmentId, live, now);
  }
  return removed;
}

/** `orgs/<orgId>/projects/<projectId>` — a gone project drops its whole
 *  subtree (escape hatch included); a live one recurses into its envs. */
async function reconcileProjects(
  organizationId: OrganizationId,
  live: LiveIds,
  now: number,
): Promise<number> {
  let removed = 0;
  for (const name of await listDirNames(join(orgDir(organizationId), "projects"))) {
    const projectId = parseDirId(idSchema.project, name);
    if (!projectId) continue;
    if (!live.projects.has(name)) {
      await removeProjectDir(organizationId, projectId);
      removed += 1;
      continue;
    }
    removed += await reconcileEnvs(organizationId, projectId, live, now);
  }
  return removed;
}

/** `orgs/<orgId>` — a gone org drops its whole subtree (durable backup repos
 *  included: org deletion is the one place allowed to); a live one recurses. */
async function reconcileOrgs(live: LiveIds, now: number): Promise<number> {
  let removed = 0;
  for (const name of await listDirNames(join(DATA_ROOT, "orgs"))) {
    const organizationId = parseDirId(idSchema.organization, name);
    if (!organizationId) continue;
    if (!live.orgs.has(name)) {
      await removeOrgDir(organizationId);
      removed += 1;
      continue;
    }
    removed += await reconcileProjects(organizationId, live, now);
  }
  return removed;
}

/** `work/sources/<projectId>` — a deleted project's staged upload tarballs.
 *  Live buckets are left alone: the builder consumes (deletes) each tarball
 *  after extraction. */
async function reconcileSourceBuckets(live: LiveIds): Promise<number> {
  let removed = 0;
  const base = join(DATA_ROOT, "work", "sources");
  for (const name of await listDirNames(base)) {
    if (live.projects.has(name)) continue;
    await removeGuardedDir(join(base, name), name);
    removed += 1;
  }
  return removed;
}

/**
 * One reconcile pass. Walks the tenant tree top-down and removes any level
 * whose id is absent from its table, plus orphaned `work/sources` buckets.
 * Never throws; returns the number of paths removed. No-ops when the data
 * folder isn't writable.
 */
async function sweepDataFolder(now = Date.now()): Promise<number> {
  if (!(await dataRootAvailable())) return 0;
  let removed = 0;
  try {
    const live: LiveIds = {
      orgs: new Set((await db.select({ id: organization.id }).from(organization)).map((o) => o.id)),
      projects: new Set((await db.select({ id: project.id }).from(project)).map((p) => p.id)),
      environments: new Set(
        (await db.select({ id: environment.id }).from(environment)).map((e) => e.id),
      ),
      resources: new Set((await db.select({ id: resource.id }).from(resource)).map((r) => r.id)),
    };

    removed += await reconcileOrgs(live, now);
    removed += await reconcileSourceBuckets(live);

    if (removed > 0) {
      globalLog.info({
        dataFolderSweep: { event: "reclaimed", removed },
      });
    }
  } catch (cause) {
    globalLog.warn({
      dataFolderSweep: { event: "failed" },
      error: cause instanceof Error ? cause.message : String(cause),
    });
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
