/**
 * Preview lifecycle controls — the Settings tab of the preview panel.
 * Rebuild, redeploy, pause/resume, teardown-now, and keep-alive. Every action
 * goes through the same guard (project-in-org + preview belongs to it + preview
 * still open) and, like every preview roll, never rewrites the shared BASE
 * resource status (redeployOne handles that when opts.previewId is set).
 */
import type { GitRepoId, PreviewId, ProjectId, ResourceId } from "@otterdeploy/shared/id";
import type { RequestLogger } from "evlog";

import { db } from "@otterdeploy/db";
import { deployment, resource, serviceResource } from "@otterdeploy/db/schema/project";
import { Result } from "better-result";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { log as globalLog } from "evlog";

import type { ProjectRef } from "../scopes";
import type { PreviewRow } from "./queries";

import { runtimeServiceName, type PreviewScope } from "../../lib/environment/scoping";
import { buildContainerName } from "./view-helpers";
import { branchProjectDatabases } from "../../git/preview-db";
import { defaultTeardownAt } from "../../git/preview-env";
import { triggerPreviewBuild } from "../../git/preview-deploy";
import { destroyPreviewBranchDbs, teardownPreview } from "../../git/preview-teardown";
import { redeployOne } from "../service/redeploy";
import { runtime } from "../../runtime";
import { ProjectNotFoundError } from "./errors";
import {
  getPreviewById,
  getProjectInOrg,
  listDatabaseResourceRecords,
  markPreviewClosedById,
  setPreviewAutoTeardown,
  setPreviewPaused,
} from "./queries";

interface PreviewControlScope extends ProjectRef {
  previewId: PreviewId;
}

async function guard(
  input: PreviewControlScope,
): Promise<Result<{ project: { slug: string }; preview: PreviewRow }, ProjectNotFoundError>> {
  const project = await getProjectInOrg({
    projectId: input.projectId,
    organizationId: input.organizationId,
  });
  if (!project) return Result.err(new ProjectNotFoundError({ projectId: input.projectId }));
  const preview = await getPreviewById(input.previewId);
  if (!preview || preview.projectId !== input.projectId || preview.state !== "active") {
    return Result.err(new ProjectNotFoundError({ projectId: input.projectId }));
  }
  return Result.ok({ project, preview });
}

function scopeOf(preview: PreviewRow): PreviewScope {
  return { id: preview.id, slug: preview.slug, prNumber: preview.prNumber };
}

/** The opted-in base git services this preview builds — the deploy predicate. */
async function previewServices(
  projectId: ProjectId,
  gitRepoId: GitRepoId,
): Promise<{ resourceId: ResourceId; serviceName: string }[]> {
  const rows = await db
    .select({ resourceId: resource.id, serviceName: serviceResource.serviceName })
    .from(resource)
    .innerJoin(serviceResource, eq(serviceResource.resourceId, resource.id))
    .where(
      and(
        eq(resource.projectId, projectId),
        eq(resource.type, "service"),
        eq(serviceResource.source, "git"),
        eq(serviceResource.gitRepoId, gitRepoId),
        eq(serviceResource.previewsEnabled, true),
        isNull(resource.previewId),
      ),
    );
  return rows.map((r) => ({ resourceId: r.resourceId as ResourceId, serviceName: r.serviceName }));
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

/** Resume/rebuild/redeploy are activity: clear the pause flag and re-arm the
 *  idle clock (preserving a keep-alive pin) so the reaper doesn't tear down a
 *  preview the user just interacted with. */
async function resumeActivity(preview: PreviewRow): Promise<void> {
  await setPreviewPaused(preview.id, false);
  const next = defaultTeardownAt();
  // Only re-arm a timed deadline; a pin (NULL) stays pinned, and a disabled
  // idle policy (next===null) leaves it alone.
  if (next && preview.autoTeardownAt !== null) {
    await setPreviewAutoTeardown(preview.id, next);
  }
}

/** Roll every preview service from its last BUILT image (running preferred). */
async function rollFromLastImage(
  preview: PreviewRow,
  projectSlug: string,
  log?: RequestLogger,
): Promise<number> {
  const services = await previewServices(preview.projectId as ProjectId, preview.gitRepoId);
  let rolled = 0;
  for (const svc of services) {
    const [built] = await db
      .select({ image: deployment.image })
      .from(deployment)
      .where(
        and(
          eq(deployment.resourceId, svc.resourceId),
          eq(deployment.previewId, preview.id),
          inArray(deployment.status, ["running", "failed"]),
        ),
      )
      .orderBy(
        sql`case when ${deployment.status} = 'running' then 0 else 1 end`,
        desc(deployment.createdAt),
      )
      .limit(1);
    if (!built || built.image.startsWith("pending:")) continue;
    const res = await Result.tryPromise({
      try: () =>
        redeployOne(preview.projectId as ProjectId, svc.resourceId, projectSlug, log, {
          previewId: preview.id,
          imageOverride: built.image,
        }),
      catch: (cause) => cause,
    });
    if (res.isOk() && res.value.isOk()) rolled++;
    else globalLog.warn({ preview: { step: "roll", previewId: preview.id, svc: svc.serviceName } });
  }
  return rolled;
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

/** Enable an isolated DB branch for this preview NOW (regardless of the base
 *  per-database opt-in), then roll services so ${{db.*}} re-resolves to the
 *  branch. Idempotent — branchProjectDatabases skips already-branched DBs. */
export async function enablePreviewDbBranch(
  input: PreviewControlScope,
  log?: RequestLogger,
): Promise<Result<{ branched: number }, ProjectNotFoundError>> {
  const g = await guard(input);
  if (g.isErr()) return Result.err(g.error);
  const { preview, project } = g.value;
  const branched = await branchProjectDatabases({
    projectId: preview.projectId as ProjectId,
    projectSlug: project.slug,
    previewId: preview.id,
    previewSlug: preview.slug,
    force: true,
    rlog: log,
  });
  await rollFromLastImage(preview, project.slug, log);
  return Result.ok({ branched });
}

/** Destroy this preview's DB branches; services fall back to the base DB on
 *  the next roll. */
export async function disablePreviewDbBranch(
  input: PreviewControlScope,
  log?: RequestLogger,
): Promise<Result<{ destroyed: number }, ProjectNotFoundError>> {
  const g = await guard(input);
  if (g.isErr()) return Result.err(g.error);
  const { preview, project } = g.value;
  const destroyed = await destroyPreviewBranchDbs(
    {
      id: preview.id,
      projectId: preview.projectId as ProjectId,
      projectSlug: project.slug,
      slug: preview.slug,
    },
    log,
  );
  await rollFromLastImage(preview, project.slug, log);
  return Result.ok({ destroyed });
}

/** Re-seed the branch from current base data: destroy the branch DBs, re-branch
 *  from base, then roll ONCE. Deliberately skips disable's intermediate roll —
 *  that would briefly point services at the base (production) DB. During the
 *  copy the old containers hit the now-gone branch (connection errors, not
 *  production writes), which is the safe failure mode. */
export async function resetPreviewDbBranch(
  input: PreviewControlScope,
  log?: RequestLogger,
): Promise<Result<{ branched: number }, ProjectNotFoundError>> {
  const g = await guard(input);
  if (g.isErr()) return Result.err(g.error);
  const { preview, project } = g.value;
  await destroyPreviewBranchDbs(
    {
      id: preview.id,
      projectId: preview.projectId as ProjectId,
      projectSlug: project.slug,
      slug: preview.slug,
    },
    log,
  );
  const branched = await branchProjectDatabases({
    projectId: preview.projectId as ProjectId,
    projectSlug: project.slug,
    previewId: preview.id,
    previewSlug: preview.slug,
    force: true,
    rlog: log,
  });
  await rollFromLastImage(preview, project.slug, log);
  return Result.ok({ branched });
}
