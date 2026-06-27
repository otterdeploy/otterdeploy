/**
 * Project-scoped dependency graph. Derived (not stored): walks every service
 * env var in the project, parses `${{<Resource>.<VAR>}}` references via the
 * shared variable parser, and resolves resource names to ids.
 *
 * Used by the graph view to draw edges between consuming services and the
 * databases / other services they depend on. Cheap enough to recompute on
 * every read — the project's env-var set is small.
 */
import type { ProjectId, ResourceId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { resource, serviceEnvVar } from "@otterdeploy/db/schema/project";
import { Result } from "better-result";
import { eq } from "drizzle-orm";

import type { ProjectRef } from "../scopes";

import { parseValue } from "../../lib/variables/parser";
import { ProjectNotFoundError } from "./errors";
import { getProjectInOrg } from "./queries";

export interface DependencyEdge {
  projectId: ProjectId;
  source: ResourceId;
  target: ResourceId;
}

export async function listProjectDependencies(
  input: ProjectRef,
): Promise<Result<DependencyEdge[], ProjectNotFoundError>> {
  const project = await getProjectInOrg({
    projectId: input.projectId,
    organizationId: input.organizationId,
  });
  if (!project) {
    return Result.err(new ProjectNotFoundError({ projectId: input.projectId }));
  }

  // Resource name -> id lookup for the whole project, in one round trip.
  // Names are unique per project (resource_project_name_unique).
  const resources = await db
    .select({ id: resource.id, name: resource.name })
    .from(resource)
    .where(eq(resource.projectId, input.projectId));
  const nameToId = new Map<string, ResourceId>();
  for (const r of resources) nameToId.set(r.name, r.id);

  // Every env var across every service in the project. The inner join scopes
  // to services owned by this project (no cross-tenant leakage).
  const envVars = await db
    .select({
      serviceResourceId: serviceEnvVar.serviceResourceId,
      value: serviceEnvVar.value,
    })
    .from(serviceEnvVar)
    .innerJoin(resource, eq(resource.id, serviceEnvVar.serviceResourceId))
    .where(eq(resource.projectId, input.projectId));

  // Dedupe edges via a "source|target" key. A service referencing the same
  // resource in 10 env vars produces one edge.
  const seen = new Set<string>();
  const edges: DependencyEdge[] = [];

  for (const ev of envVars) {
    const parsed = parseValue(ev.value);
    // Unparseable values aren't this endpoint's concern — they show up as
    // validation errors via the service.env.set/bulkSet paths.
    if (!parsed.ok) continue;

    for (const token of parsed.tokens) {
      if (token.kind !== "ref") continue;
      const targetId = nameToId.get(token.resource);
      if (!targetId) continue; // dangling ref; skip
      if (targetId === ev.serviceResourceId) continue; // self-ref; skip

      const key = `${ev.serviceResourceId}|${targetId}`;
      if (seen.has(key)) continue;
      seen.add(key);

      edges.push({
        projectId: input.projectId,
        source: ev.serviceResourceId as ResourceId,
        target: targetId,
      });
    }
  }

  return Result.ok(edges);
}
