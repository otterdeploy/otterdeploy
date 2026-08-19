/**
 * Project-scoped dependency graph. Derived (not stored): walks every service
 * env var in the project, parses `${{<Resource>.<VAR>}}` references via the
 * shared variable parser, and resolves them to ids — by resource name for the
 * flat form, by (stack, compose service key) for the stack-scoped one.
 *
 * Used by the graph view to draw edges between consuming services and the
 * databases / other services they depend on. Cheap enough to recompute on
 * every read. The project's env-var set is small.
 */
import type { ProjectId, ResourceId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { resource, serviceEnvVar, serviceResource } from "@otterdeploy/db/schema/project";
import { Result } from "better-result";
import { and, eq, isNull } from "drizzle-orm";

import type { ProjectRef } from "../scopes";

import { decryptEnvValue } from "../../lib/env-crypto";
import { parseValue } from "../../lib/variables/parser";
import { buildRefIndex, resolveRefTargetId } from "../../lib/variables/stack-refs";
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

  // Every resource in the project, in one round trip. Names are unique per
  // project (resource_project_name_unique), so they index cleanly.
  const resources = await db
    .select({ id: resource.id, name: resource.name })
    .from(resource)
    .where(eq(resource.projectId, input.projectId));

  // Stack membership for the same project, in one more round trip: it's what
  // lets a stack-scoped ref resolve by compose service key. See
  // [[resolveRefTargetId]] for why that can't go through the name map.
  const members = await db
    .select({
      resourceId: serviceResource.resourceId,
      stackId: serviceResource.stackId,
      composeService: serviceResource.composeService,
    })
    .from(serviceResource)
    .innerJoin(resource, eq(resource.id, serviceResource.resourceId))
    .where(eq(resource.projectId, input.projectId));
  const refIndex = buildRefIndex({ resources, members });

  // Every env var across every service in the project. The inner join scopes
  // to services owned by this project (no cross-tenant leakage).
  const envVars = await db
    .select({
      serviceResourceId: serviceEnvVar.serviceResourceId,
      value: serviceEnvVar.value,
      sealed: serviceEnvVar.sealed,
    })
    .from(serviceEnvVar)
    .innerJoin(resource, eq(resource.id, serviceEnvVar.serviceResourceId))
    // Base rows only: preview overrides must not fabricate base graph edges.
    .where(
      and(
        eq(resource.projectId, input.projectId),
        isNull(serviceEnvVar.previewId),
      ),
    );

  // Dedupe edges via a "source|target" key. A service referencing the same
  // resource in 10 env vars produces one edge.
  const seen = new Set<string>();
  const edges: DependencyEdge[] = [];

  for (const ev of envVars) {
    // Values are encrypted at rest (od-3pp7). Sealed rows are skipped: their
    // plaintext never leaves the resolver, and pre-encryption this scan could
    // not see into them either (it parsed ciphertext), so no edges are lost.
    if (ev.sealed) continue;
    const parsed = parseValue(await decryptEnvValue(ev.value));
    // Unparseable values aren't this endpoint's concern. They show up as
    // validation errors via the service.env.set/bulkSet paths.
    if (!parsed.ok) continue;

    for (const token of parsed.tokens) {
      if (token.kind !== "ref") continue;
      const targetId = resolveRefTargetId(token, ev.serviceResourceId, refIndex);
      if (!targetId) continue; // dangling ref; skip
      if (targetId === ev.serviceResourceId) continue; // self-ref; skip

      const key = `${ev.serviceResourceId}|${targetId}`;
      if (seen.has(key)) continue;
      seen.add(key);

      edges.push({
        projectId: input.projectId,
        source: ev.serviceResourceId,
        target: targetId,
      });
    }
  }

  return Result.ok(edges);
}
