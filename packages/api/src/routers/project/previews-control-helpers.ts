/**
 * Shared plumbing for the preview control handlers (previews-controls.ts,
 * previews-db-branch.ts): the org/preview guard, the idle-clock re-arm, and
 * the roll-from-last-built-image pass.
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

import { defaultTeardownAt } from "../../git/preview-env";
import { redeployOne } from "../service/redeploy";
import { ProjectNotFoundError } from "./errors";
import {
  getPreviewById,
  getProjectInOrg,
  setPreviewAutoTeardown,
  setPreviewPaused,
} from "./queries";

export interface PreviewControlScope extends ProjectRef {
  previewId: PreviewId;
}

export async function guard(
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

/** Resume/rebuild/redeploy are activity: clear the pause flag and re-arm the
 *  idle clock (preserving a keep-alive pin) so the reaper doesn't tear down a
 *  preview the user just interacted with. */
export async function resumeActivity(preview: PreviewRow): Promise<void> {
  await setPreviewPaused(preview.id, false);
  const next = defaultTeardownAt();
  // Only re-arm a timed deadline; a pin (NULL) stays pinned, and a disabled
  // idle policy (next===null) leaves it alone.
  if (next && preview.autoTeardownAt !== null) {
    await setPreviewAutoTeardown(preview.id, next);
  }
}

/** Roll every preview service from its last BUILT image (running preferred). */
export async function rollFromLastImage(
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
