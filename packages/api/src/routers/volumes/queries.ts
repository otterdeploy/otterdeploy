/**
 * Org-scoped DB reads feeding the volume ↔ resource mapping (see mapping.ts).
 * Three claim sources plus a resource directory for label resolution:
 *
 *   - database rows   → volume name via `buildVolumeName` (naming convention
 *                       the provisioner deploys with) + `legacy_volume_name`.
 *   - service mounts  → `service_mount` rows with type=volume carry the exact
 *                       docker volume name in `source`.
 *   - compose stacks  → `stack_name` (swarm namespace); stack volumes are
 *                       deployed as `<stackName>_<volumeKey>`.
 */
import type { OrganizationId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import {
  composeResource,
  databaseResource,
  project,
  resource,
  serviceMount,
  serviceResource,
} from "@otterdeploy/db/schema";
import { and, eq } from "drizzle-orm";

import type { ResourceInfo, StackClaim, VolumeClaim } from "./mapping";

import { buildVolumeName } from "../project/view-helpers";

export interface OrgVolumeClaims {
  claims: VolumeClaim[];
  stackClaims: StackClaim[];
  resources: ResourceInfo[];
}

export async function loadOrgVolumeClaims(
  organizationId: OrganizationId,
): Promise<OrgVolumeClaims> {
  const [databases, mounts, stacks, allResources] = await Promise.all([
    // Databases (incl. preview branches — their resource rows are named
    // `<base>-<previewSlug>`, so the same convention resolves them).
    db
      .select({
        resourceId: resource.id,
        resourceName: resource.name,
        projectId: resource.projectId,
        projectSlug: project.slug,
        engine: databaseResource.engine,
        legacyVolumeName: databaseResource.legacyVolumeName,
      })
      .from(databaseResource)
      .innerJoin(resource, eq(databaseResource.resourceId, resource.id))
      .innerJoin(project, eq(resource.projectId, project.id))
      .where(eq(project.organizationId, organizationId)),

    db
      .select({
        source: serviceMount.source,
        resourceId: resource.id,
        resourceName: resource.name,
        projectId: resource.projectId,
        projectSlug: project.slug,
      })
      .from(serviceMount)
      .innerJoin(serviceResource, eq(serviceMount.serviceResourceId, serviceResource.resourceId))
      .innerJoin(resource, eq(serviceResource.resourceId, resource.id))
      .innerJoin(project, eq(resource.projectId, project.id))
      .where(and(eq(serviceMount.type, "volume"), eq(project.organizationId, organizationId))),

    db
      .select({
        stackName: composeResource.stackName,
        resourceId: resource.id,
        resourceName: resource.name,
        projectId: resource.projectId,
        projectSlug: project.slug,
      })
      .from(composeResource)
      .innerJoin(resource, eq(composeResource.resourceId, resource.id))
      .innerJoin(project, eq(resource.projectId, project.id))
      .where(eq(project.organizationId, organizationId)),

    // Directory of every org resource, for container-label → resource lookup.
    db
      .select({
        resourceId: resource.id,
        resourceName: resource.name,
        resourceType: resource.type,
        projectId: resource.projectId,
        projectSlug: project.slug,
        engine: databaseResource.engine,
      })
      .from(resource)
      .innerJoin(project, eq(resource.projectId, project.id))
      .leftJoin(databaseResource, eq(databaseResource.resourceId, resource.id))
      .where(eq(project.organizationId, organizationId)),
  ]);

  const claims: VolumeClaim[] = [];
  for (const row of databases) {
    const base = {
      resourceId: row.resourceId,
      resourceName: row.resourceName,
      resourceType: "database" as const,
      projectId: row.projectId,
      projectSlug: row.projectSlug,
      engine: row.engine,
    };
    claims.push({
      ...base,
      volumeName: buildVolumeName({
        engine: row.engine,
        projectSlug: row.projectSlug,
        resourceName: row.resourceName,
      }),
    });
    if (row.legacyVolumeName) {
      claims.push({ ...base, volumeName: row.legacyVolumeName });
    }
  }
  for (const row of mounts) {
    if (!row.source) continue;
    claims.push({
      volumeName: row.source,
      resourceId: row.resourceId,
      resourceName: row.resourceName,
      resourceType: "service",
      projectId: row.projectId,
      projectSlug: row.projectSlug,
      engine: null,
    });
  }

  const stackClaims: StackClaim[] = stacks.map((s) => ({
    stackName: s.stackName,
    resourceId: s.resourceId,
    resourceName: s.resourceName,
    projectId: s.projectId,
    projectSlug: s.projectSlug,
  }));

  const resources: ResourceInfo[] = allResources.map((r) => ({
    resourceId: r.resourceId,
    resourceName: r.resourceName,
    resourceType: r.resourceType,
    projectId: r.projectId,
    projectSlug: r.projectSlug,
    engine: r.engine ?? null,
  }));

  return { claims, stackClaims, resources };
}
