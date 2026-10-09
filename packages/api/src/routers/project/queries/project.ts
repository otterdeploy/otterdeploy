import type {
  EnvironmentId,
  OrganizationId,
  ProjectId,
  ProxyRouteId,
  ServerId,
} from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import {
  environment,
  project,
  projectEnvVar,
  type NixpacksConfig,
} from "@otterdeploy/db/schema/project";
import { and, asc, eq } from "drizzle-orm";

import { getProxyRouteById } from "../../../caddy/queries";
import { decryptForDomain } from "../../../lib/crypto";
import { decryptEnvValue } from "../../../lib/env-crypto";

export { createProjectRecord } from "./project-create";

// The org-wide GROUP BY tallies behind the project-list cards now live in
// ./project-tallies.ts (this file stays row-level project/environment CRUD).
// Re-exported here so `./queries`' barrel, and anything importing this module
// directly: keeps the exact same surface as before the split.
export {
  countEnabledRoutesByProject,
  countResourcesByProject,
  listServiceResourceRefsByOrg,
} from "./project-tallies";

export async function listProjectRecordsByOrg(organizationId: OrganizationId) {
  return db
    .select({
      id: project.id,
      name: project.name,
      slug: project.slug,
      environmentId: project.environmentId,
      buildServerId: project.buildServerId,
      stackFile: project.stackFile,
      stackFileVersion: project.stackFileVersion,
      lastAppliedFile: project.lastAppliedFile,
      lastAppliedAt: project.lastAppliedAt,
      customDomain: project.customDomain,
      customDomainVerifiedAt: project.customDomainVerifiedAt,
      customDomainVerifyToken: project.customDomainVerifyToken,
      nixpacksConfig: project.nixpacksConfig,
      graphLayout: project.graphLayout,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    })
    .from(project)
    .where(eq(project.organizationId, organizationId))
    .orderBy(asc(project.createdAt), asc(project.name));
}

/**
 * Loads a project by id and verifies it belongs to the given organization.
 * Returns undefined if no project exists or it belongs to a different org.
 */
export async function getProjectInOrg(input: {
  projectId: ProjectId;
  organizationId: OrganizationId;
}) {
  const [record] = await db
    .select()
    .from(project)
    .where(and(eq(project.id, input.projectId), eq(project.organizationId, input.organizationId)))
    .limit(1);
  return record;
}

/** Load a proxy route and verify it belongs to a project in the caller's
 *  org. Centralizes the auth check for every protection mutation; returns
 *  null for both "missing" and "other org" so existence never leaks. */
export async function getRouteInOrg(routeId: ProxyRouteId, organizationId: OrganizationId) {
  const route = await getProxyRouteById(routeId);
  if (!route) return null;
  const proj = await getProjectInOrg({
    projectId: route.projectId,
    organizationId,
  });
  if (!proj) return null;
  return route;
}

export async function getProjectById(projectId: ProjectId) {
  const [record] = await db.select().from(project).where(eq(project.id, projectId)).limit(1);
  return record;
}

/** Alias for getProjectById: kept so existing call sites continue to read naturally. */
export const getProjectRecord = getProjectById;

/** Load a single environment row by id. Used by the variable resolver to read
 *  an env's `baseEnvironmentId` (for inherit-by-reference). */
export async function getEnvironmentById(environmentId: EnvironmentId) {
  const [record] = await db
    .select()
    .from(environment)
    .where(eq(environment.id, environmentId))
    .limit(1);
  return record;
}

export async function getProjectBySlugInOrg(input: {
  slug: string;
  organizationId: OrganizationId;
}) {
  const [record] = await db
    .select()
    .from(project)
    .where(and(eq(project.slug, input.slug), eq(project.organizationId, input.organizationId)))
    .limit(1);
  return record;
}

export async function updateProjectRecord(input: {
  projectId: ProjectId;
  organizationId: OrganizationId;
  name?: string;
  slug?: string;
  customDomain?: string | null;
  gitRepoId?: string | null;
  productionBranch?: string;
  containerRegistryId?: string | null;
  imageRepository?: string | null;
  nixpacksConfig?: NixpacksConfig | null;
  buildServerId?: ServerId | null;
}) {
  // Build the patch object incrementally so undefined fields stay
  // unset (drizzle/postgres treat undefined as "no column update").
  const patch: Partial<typeof project.$inferInsert> = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.buildServerId !== undefined) patch.buildServerId = input.buildServerId;
  if (input.slug !== undefined) patch.slug = input.slug;
  if (input.customDomain !== undefined) {
    patch.customDomain = input.customDomain;
    // Changing the bound domain invalidates any previous verification.
    // Operator has to re-prove ownership of the new one. `null` clears
    // back to org fallback, also no verification needed.
    patch.customDomainVerifiedAt = null;
    patch.customDomainVerifyToken = null;
  }
  if (input.nixpacksConfig !== undefined) patch.nixpacksConfig = input.nixpacksConfig;

  if (Object.keys(patch).length === 0) {
    // No-op: return the current row so the caller still gets the view shape.
    const [row] = await db
      .select()
      .from(project)
      .where(and(eq(project.id, input.projectId), eq(project.organizationId, input.organizationId)))
      .limit(1);
    return row;
  }

  const [record] = await db
    .update(project)
    .set(patch)
    .where(and(eq(project.id, input.projectId), eq(project.organizationId, input.organizationId)))
    .returning();
  return record;
}

/** Overwrite the project's whole graph-layout map (callers merge first). */
export async function setProjectGraphLayout(input: {
  projectId: ProjectId;
  organizationId: OrganizationId;
  graphLayout: Record<string, { x: number; y: number }>;
}) {
  const [record] = await db
    .update(project)
    .set({ graphLayout: input.graphLayout })
    .where(and(eq(project.id, input.projectId), eq(project.organizationId, input.organizationId)))
    .returning({ id: project.id });
  return record;
}

export async function deleteProjectRecord(input: {
  projectId: ProjectId;
  organizationId: OrganizationId;
}) {
  const [record] = await db
    .delete(project)
    .where(and(eq(project.id, input.projectId), eq(project.organizationId, input.organizationId)))
    .returning({ id: project.id });
  return record;
}

/**
 * Load all project-level env vars for the given (project, environment)
 * pair, flattened to a plain `Record<string,string>`. Used by the variable
 * resolver to back `${{project.X}}` and `${{environment.X}}` references:
 * both magic names resolve from this same bag today (a project carries
 * exactly one environment row), keeping the door open for per-environment
 * specialization when multi-env projects ship.
 *
 * Returns an empty record when nothing is configured. Secrets are not
 * specially masked here: values are emitted verbatim into the container
 * env, which is the only way a workload can actually consume them. This IS
 * the deploy/injection boundary, so sealed rows are decrypted here (and
 * only here / the equivalent service-env path): see packages/api/src/
 * lib/crypto.ts's "env-vars" domain.
 */
export async function loadProjectEnvBag(input: {
  projectId: ProjectId;
  environmentId: EnvironmentId;
}): Promise<Record<string, string>> {
  const rows = await db
    .select({
      key: projectEnvVar.key,
      value: projectEnvVar.value,
      sealed: projectEnvVar.sealed,
    })
    .from(projectEnvVar)
    .where(
      and(
        eq(projectEnvVar.projectId, input.projectId),
        eq(projectEnvVar.environmentId, input.environmentId),
      ),
    );
  const out: Record<string, string> = {};
  for (const row of rows) {
    // Sealed rows are always ciphertext (loud failure on a bad keyring);
    // unsealed rows decrypt-or-passthrough until the od-3pp7 backfill runs.
    out[row.key] = row.sealed
      ? await decryptForDomain(row.value, "env-vars")
      : await decryptEnvValue(row.value);
  }
  return out;
}
