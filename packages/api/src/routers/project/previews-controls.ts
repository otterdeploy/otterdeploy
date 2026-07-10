/**
 * Preview lifecycle controls — the Settings tab of the preview panel.
 * Rebuild, redeploy, pause/resume, teardown-now, and keep-alive. Every action
 * goes through the same guard (project-in-org + preview belongs to it + preview
 * still open) and, like every preview roll, never rewrites the shared BASE
 * resource status (redeployOne handles that when opts.previewId is set).
 * Shared guard/roll plumbing lives in previews-control-helpers.ts; the
 * DB-branch controls in previews-db-branch.ts (re-exported here).
 */
import type { GitRepoId, ProjectId } from "@otterdeploy/shared/id";
import type { RequestLogger } from "evlog";

import { db } from "@otterdeploy/db";
import { resource, serviceResource } from "@otterdeploy/db/schema/project";
import { Result } from "better-result";
import { and, eq, isNull } from "drizzle-orm";
import { log as globalLog } from "evlog";

import type { PreviewRow } from "./queries";

import { triggerPreviewBuild } from "../../git/preview-deploy";
import { defaultTeardownAt } from "../../git/preview-env";
import { teardownPreview } from "../../git/preview-teardown";
import { runtimeServiceName, type PreviewScope } from "../../lib/environment/scoping";
import { runtime } from "../../runtime";
import { ProjectNotFoundError } from "./errors";
import {
  guard,
  resumeActivity,
  rollFromLastImage,
  type PreviewControlScope,
} from "./previews-control-helpers";
import {
  listDatabaseResourceRecords,
  markPreviewClosedById,
  setPreviewAutoTeardown,
  setPreviewPaused,
} from "./queries";
import { buildContainerName } from "./view-helpers";

export {
  disablePreviewDbBranch,
  enablePreviewDbBranch,
  resetPreviewDbBranch,
} from "./previews-db-branch";

function scopeOf(preview: PreviewRow): PreviewScope {
  return { id: preview.id, slug: preview.slug, prNumber: preview.prNumber };
}

/** ALL of this repo's base git service names in the project — used by pause,
 *  which must stop even services that opted OUT of previews after deploying
 *  (destroy is a no-op for containers that don't exist). */
async function allPreviewServiceNames(
  projectId: ProjectId,
  gitRepoId: GitRepoId,
): Promise<string[]> {
  const rows = await db
    .select({ serviceName: serviceResource.serviceName })
    .from(resource)
    .innerJoin(serviceResource, eq(serviceResource.resourceId, resource.id))
    .where(
      and(
        eq(resource.projectId, projectId),
        eq(resource.type, "service"),
        eq(serviceResource.source, "git"),
        eq(serviceResource.gitRepoId, gitRepoId),
        isNull(resource.previewId),
      ),
    );
  return rows.map((r) => r.serviceName);
}

export async function rebuildPreview(
  input: PreviewControlScope,
): Promise<Result<{ deploymentsCreated: number }, ProjectNotFoundError>> {
  const g = await guard(input);
  if (g.isErr()) return Result.err(g.error);
  const { preview } = g.value;
  await resumeActivity(preview);
  const created = await triggerPreviewBuild({
    projectId: preview.projectId as ProjectId,
    gitRepoId: preview.gitRepoId,
    previewId: preview.id,
    sha: preview.headSha,
    branch: preview.branch,
  });
  return Result.ok({ deploymentsCreated: created });
}

export async function redeployPreview(
  input: PreviewControlScope,
  log?: RequestLogger,
): Promise<Result<{ rolled: number }, ProjectNotFoundError>> {
  const g = await guard(input);
  if (g.isErr()) return Result.err(g.error);
  await resumeActivity(g.value.preview);
  return Result.ok({ rolled: await rollFromLastImage(g.value.preview, g.value.project.slug, log) });
}

export async function pausePreview(
  input: PreviewControlScope,
  log?: RequestLogger,
): Promise<Result<{ paused: true }, ProjectNotFoundError>> {
  const g = await guard(input);
  if (g.isErr()) return Result.err(g.error);
  const { preview } = g.value;
  const scope = scopeOf(preview);
  // Stop ALL of this repo's services (incl. ones that opted out after deploy)
  // plus the preview's branch DB containers — everything the preview runs.
  const services = await allPreviewServiceNames(preview.projectId as ProjectId, preview.gitRepoId);
  let destroyFailed = 0;
  for (const serviceName of services.map((n) => runtimeServiceName(n, scope))) {
    const r = await Result.tryPromise({
      try: () => runtime().destroy({ serviceName }, log),
      catch: (cause) => cause,
    });
    if (r.isErr()) {
      destroyFailed++;
      globalLog.warn({ preview: { step: "pause-destroy", previewId: preview.id, serviceName } });
    }
  }
  // Stop branch DB containers too (destroy the container, keep the volume/row —
  // resume re-runs the DB and its data survives). buildContainerName gives the
  // branch container's name; runtime().destroy removes the container only.
  const branches = (await listDatabaseResourceRecords(preview.projectId as ProjectId)).filter(
    (r) => r.resource.previewId === preview.id,
  );
  for (const br of branches) {
    const serviceName = buildContainerName({
      engine: br.database.engine,
      projectSlug: g.value.project.slug,
      resourceName: `${br.resource.name}-${preview.slug}`,
    });
    await Result.tryPromise({
      try: () => runtime().destroy({ serviceName }, log),
      catch: (cause) => cause,
    });
  }
  await setPreviewPaused(preview.id, true);
  return Result.ok({ paused: true, destroyFailed });
}

export async function resumePreview(
  input: PreviewControlScope,
  log?: RequestLogger,
): Promise<Result<{ rolled: number }, ProjectNotFoundError>> {
  const g = await guard(input);
  if (g.isErr()) return Result.err(g.error);
  const { preview, project } = g.value;
  const rolled = await rollFromLastImage(preview, project.slug, log);
  await resumeActivity(preview);
  return Result.ok({ rolled });
}

export async function teardownPreviewNow(
  input: PreviewControlScope,
  log?: RequestLogger,
): Promise<Result<{ torn: true }, ProjectNotFoundError>> {
  const g = await guard(input);
  if (g.isErr()) return Result.err(g.error);
  const { preview, project } = g.value;
  await markPreviewClosedById(preview.id);
  await teardownPreview(
    {
      id: preview.id,
      projectId: preview.projectId as ProjectId,
      projectSlug: project.slug,
      gitRepoId: preview.gitRepoId,
      slug: preview.slug,
      prNumber: preview.prNumber,
    },
    log,
  );
  return Result.ok({ torn: true });
}

export async function setPreviewKeepAlive(
  input: PreviewControlScope & { keepAlive: boolean },
): Promise<Result<{ pinned: boolean }, ProjectNotFoundError>> {
  const g = await guard(input);
  if (g.isErr()) return Result.err(g.error);
  // Pin = NULL deadline. Un-pin = the server's configured default TTL (which is
  // itself NULL when idle teardown is globally disabled, so un-pinning under a
  // disabled policy stays un-reapable — matching the documented contract).
  const deadline = input.keepAlive ? null : defaultTeardownAt();
  await setPreviewAutoTeardown(g.value.preview.id, deadline);
  return Result.ok({ pinned: deadline === null });
}
