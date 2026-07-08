/**
 * List a project's open PR previews with per-service deployment state — the
 * data behind the graph's preview satellite cards. One row per preview; one
 * service entry per opted-in git service bound to the preview's repo (the
 * same predicate the deployer uses, so the card set always matches what the
 * PR actually builds).
 */
import type { ProjectId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { deployment, resource, serviceResource } from "@otterdeploy/db/schema/project";
import { Result } from "better-result";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";

import type { ProjectRef } from "../scopes";

import { listProxyRoutesByPreview } from "../../caddy/queries";
import { ProjectNotFoundError } from "./errors";
import { getProjectInOrg, listActivePreviewsByProject } from "./queries";

export interface PreviewServiceEntry {
  resourceId: string;
  serviceName: string;
  status: "pending" | "building" | "running" | "failed" | "superseded" | "removed" | "none";
  url: string | null;
}

export interface PreviewEntry {
  id: string;
  prNumber: number;
  branch: string;
  headSha: string;
  slug: string;
  state: "active" | "closed";
  services: PreviewServiceEntry[];
}

export async function listProjectPreviews(
  input: ProjectRef,
): Promise<Result<PreviewEntry[], ProjectNotFoundError>> {
  const project = await getProjectInOrg({
    projectId: input.projectId,
    organizationId: input.organizationId,
  });
  if (!project) {
    return Result.err(new ProjectNotFoundError({ projectId: input.projectId }));
  }

  const previews = await listActivePreviewsByProject(input.projectId as ProjectId);
  if (previews.length === 0) return Result.ok([]);

  const out: PreviewEntry[] = [];
  for (const row of previews) {
    // The services this preview builds — the deployer's own opt-in predicate.
    const services = await db
      .select({ resourceId: resource.id, name: resource.name })
      .from(resource)
      .innerJoin(serviceResource, eq(serviceResource.resourceId, resource.id))
      .where(
        and(
          eq(resource.projectId, input.projectId as ProjectId),
          eq(resource.type, "service"),
          eq(serviceResource.source, "git"),
          eq(serviceResource.gitRepoId, row.gitRepoId),
          eq(serviceResource.previewsEnabled, true),
          isNull(serviceResource.stackId),
          isNull(resource.previewId),
        ),
      );
    if (services.length === 0) continue;

    const deployments = await db
      .select({
        resourceId: deployment.resourceId,
        status: deployment.status,
        createdAt: deployment.createdAt,
      })
      .from(deployment)
      .where(
        and(
          eq(deployment.previewId, row.id),
          inArray(
            deployment.resourceId,
            services.map((s) => s.resourceId),
          ),
        ),
      )
      .orderBy(desc(deployment.createdAt));
    const latestByResource = new Map<string, (typeof deployments)[number]>();
    for (const dep of deployments) {
      if (!latestByResource.has(dep.resourceId)) latestByResource.set(dep.resourceId, dep);
    }

    const routes = await listProxyRoutesByPreview(row.id);

    out.push({
      id: row.id,
      prNumber: row.prNumber,
      branch: row.branch,
      headSha: row.headSha,
      slug: row.slug,
      state: row.state,
      services: services.map((svc) => {
        const dep = latestByResource.get(svc.resourceId);
        const route = routes.find((r) => r.resourceId === svc.resourceId);
        return {
          resourceId: svc.resourceId,
          serviceName: svc.name,
          status: dep?.status ?? "none",
          url: route ? `https://${route.domain}` : null,
        };
      }),
    });
  }
  return Result.ok(out);
}
