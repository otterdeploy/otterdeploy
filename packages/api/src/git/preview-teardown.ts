/**
 * Tear down a preview when its PR closes: destroy the preview-scoped service
 * containers, destroy + delete the branched databases (container AND volume —
 * a branch's data is disposable), then drop the preview's proxy routes and
 * reconcile Caddy.
 *
 * Best-effort throughout: a single failure logs and teardown continues, so a
 * stuck container can't strand the rest. Runs inline from the webhook; like
 * branching it should move to a background job before heavy use.
 */
import type { GitRepoId, PreviewId, ProjectId } from "@otterdeploy/shared/id";
import type { RequestLogger } from "evlog";

import { db } from "@otterdeploy/db";
import { resource, serviceResource } from "@otterdeploy/db/schema/project";
import { Result } from "better-result";
import { and, eq, isNull } from "drizzle-orm";
import { log } from "evlog";

import { reconcile } from "../caddy";
import { type PreviewScope, runtimeServiceName } from "../lib/environment/scoping";
import { deleteResourceById, listDatabaseResourceRecords } from "../routers/project/queries";
import { buildContainerName } from "../routers/project/view-helpers";
import { runtime } from "../runtime";
import { removePreviewRoutes } from "./preview-routes";

export interface ClosedPreview {
  id: PreviewId;
  projectId: ProjectId;
  projectSlug: string;
  /** The preview's repo — teardown must only destroy containers named for
   *  THIS repo's PR, never another repo's same-numbered preview. */
  gitRepoId: GitRepoId;
  /** The preview's repo-qualified slug (`<repoSlug>-pr-<N>`) — byte-identical
   *  to what create used, so branch container/volume names resolve. */
  slug: string;
  prNumber: number;
}

export async function teardownPreview(input: ClosedPreview, rlog?: RequestLogger): Promise<void> {
  const scope: PreviewScope = {
    id: input.id,
    slug: input.slug,
    prNumber: input.prNumber,
  };

  // 1. Destroy the preview's service containers (preview-scoped names).
  // Scoped to services bound to THIS preview's repo — the `pr-<n>` container
  // suffix is repo-agnostic, so an unscoped sweep would destroy another
  // repo's live same-numbered preview. Deliberately NOT gated on
  // previewsEnabled: a service that opted out after a preview deployed must
  // still be torn down (destroy is a no-op for containers that don't exist).
  const services = await db
    .select({ serviceName: serviceResource.serviceName })
    .from(resource)
    .innerJoin(serviceResource, eq(serviceResource.resourceId, resource.id))
    .where(
      and(
        eq(resource.projectId, input.projectId),
        eq(resource.type, "service"),
        eq(serviceResource.source, "git"),
        eq(serviceResource.gitRepoId, input.gitRepoId),
        isNull(resource.previewId),
      ),
    );
  for (const svc of services) {
    const serviceName = runtimeServiceName(svc.serviceName, scope);
    await best(() => runtime().destroy({ serviceName }, rlog), {
      step: "destroy-service",
      serviceName,
    });
  }

  // 2. Destroy + delete the branched databases (container + volume + row).
  // Branch DBs are named with the preview's full slug (`<repoSlug>-pr-<N>`) —
  // the same string create used — so destroy targets the real container.
  const branches = (await listDatabaseResourceRecords(input.projectId)).filter(
    (r) => r.resource.previewId === input.id,
  );
  for (const br of branches) {
    const serviceName = buildContainerName({
      engine: br.database.engine,
      projectSlug: input.projectSlug,
      resourceName: `${br.resource.name}-${input.slug}`,
    });
    await best(
      () =>
        runtime().destroyDatabaseBranch(
          {
            serviceName,
            projectId: input.projectId,
            resourceId: br.resource.id,
            snapshotRef: br.database.branchSnapshotRef ?? null,
          },
          rlog,
        ),
      { step: "destroy-branch", db: br.resource.name },
    );
    await best(() => deleteResourceById(br.resource.id), {
      step: "delete-branch-row",
      db: br.resource.name,
    });
  }

  // 3. Drop the preview's proxy routes and push the shrunken config to the
  // edge (skip the reconcile when the preview never had a host).
  await best(
    async () => {
      if (await removePreviewRoutes(input.id)) await reconcile(rlog);
    },
    { step: "remove-routes", previewId: input.id },
  );
}

async function best(fn: () => Promise<unknown>, ctx: Record<string, unknown>): Promise<void> {
  const r = await Result.tryPromise({ try: fn, catch: (cause) => cause });
  if (r.isErr()) log.warn({ preview: { step: "teardown", ...ctx }, err: r.error });
}
