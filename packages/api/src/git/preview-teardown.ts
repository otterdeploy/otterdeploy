/**
 * Tear down a preview environment when its PR closes (docs/designs/pr-previews.md §8):
 * destroy the env-scoped service containers, destroy + delete the branched
 * databases (container AND volume — a branch's data is disposable), then drop
 * the preview's proxy routes and reconcile Caddy.
 *
 * Best-effort throughout: a single failure logs and teardown continues, so a
 * stuck container can't strand the rest. Runs inline from the webhook; like
 * branching it should move to a background job before heavy use.
 */
import type { EnvironmentId, ProjectId } from "@otterdeploy/shared/id";
import type { RequestLogger } from "evlog";

import { db } from "@otterdeploy/db";
import { resource, serviceResource } from "@otterdeploy/db/schema/project";
import { Result } from "better-result";
import { and, eq, isNull } from "drizzle-orm";
import { log } from "evlog";

import { reconcile } from "../caddy";
import { type EnvScope, runtimeServiceName } from "../lib/environment/scoping";
import { deleteResourceById, listDatabaseResourceRecords } from "../routers/project/queries";
import { buildContainerName } from "../routers/project/view-helpers";
import { runtime } from "../runtime";
import { removePreviewRoutes } from "./preview-routes";

export interface ClosedPreviewEnv {
  id: EnvironmentId;
  projectId: ProjectId;
  projectSlug: string;
  slug: string;
  pullRequestNumber: number | null;
}

export async function teardownPreviewEnvironment(
  env: ClosedPreviewEnv,
  rlog?: RequestLogger,
): Promise<void> {
  const scope: EnvScope = {
    id: env.id,
    kind: "preview",
    slug: env.slug,
    pullRequestNumber: env.pullRequestNumber,
  };
  const previewSlug = env.pullRequestNumber != null ? `pr-${env.pullRequestNumber}` : env.slug;

  // 1. Destroy the preview's service containers (env-scoped names).
  const services = await db
    .select({ serviceName: serviceResource.serviceName })
    .from(resource)
    .innerJoin(serviceResource, eq(serviceResource.resourceId, resource.id))
    .where(
      and(
        eq(resource.projectId, env.projectId),
        eq(resource.type, "service"),
        isNull(resource.environmentId),
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
  const branches = (await listDatabaseResourceRecords(env.projectId)).filter(
    (r) => r.resource.environmentId === env.id,
  );
  for (const br of branches) {
    const serviceName = buildContainerName({
      engine: br.database.engine,
      projectSlug: env.projectSlug,
      resourceName: `${br.resource.name}-${previewSlug}`,
    });
    await best(
      () =>
        runtime().destroyDatabaseBranch(
          {
            serviceName,
            projectId: env.projectId,
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
  // edge (skip the reconcile when the env never had a host).
  await best(async () => {
    if (await removePreviewRoutes(env.id)) await reconcile(rlog);
  }, { step: "remove-routes", environmentId: env.id });
}

async function best(fn: () => Promise<unknown>, ctx: Record<string, unknown>): Promise<void> {
  const r = await Result.tryPromise({ try: fn, catch: (cause) => cause });
  if (r.isErr()) log.warn({ preview: { step: "teardown", ...ctx }, err: r.error });
}
