import type { EnvironmentId, OrganizationId, ProjectId, ResourceId } from "@otterdeploy/shared/id";
import type { InferSelectModel } from "drizzle-orm";

import { db } from "@otterdeploy/db";
import { environment, project, resource } from "@otterdeploy/db/schema/project";
import { and, asc, eq } from "drizzle-orm";

import { removeEnvDir } from "../../lib/data-dir";
type OrgId = OrganizationId;

export type EnvironmentRecord = InferSelectModel<typeof environment>;

/**
 * Environments scoped to the active organization. Optionally filter by project.
 */
export async function listEnvsByOrg(
  organizationId: OrgId,
  projectId?: ProjectId,
): Promise<EnvironmentRecord[]> {
  const conditions = projectId
    ? and(eq(project.organizationId, organizationId), eq(environment.projectId, projectId))
    : eq(project.organizationId, organizationId);

  const rows = await db
    .select({ environment })
    .from(environment)
    .innerJoin(project, eq(project.id, environment.projectId))
    .where(conditions)
    .orderBy(asc(environment.createdAt));

  return rows.map((r) => r.environment);
}

export async function getEnvInOrg(input: {
  environmentId: EnvironmentId;
  organizationId: OrgId;
}): Promise<EnvironmentRecord | undefined> {
  const [row] = await db
    .select({ environment })
    .from(environment)
    .innerJoin(project, eq(project.id, environment.projectId))
    .where(
      and(
        eq(environment.id, input.environmentId),
        eq(project.organizationId, input.organizationId),
      ),
    )
    .limit(1);
  return row?.environment;
}

/**
 * Inserts an env row. Pass `projectId` to attach immediately; omit it to
 * create a standalone env that `project.create` can claim later.
 */
export async function createEnvRecord(input: {
  id?: EnvironmentId;
  name: string;
  slug: string;
  projectId?: ProjectId;
  /** Standalone rows only: the org whose `project.create` may claim it. */
  claimableByOrganizationId?: OrgId;
}): Promise<EnvironmentRecord | undefined> {
  const [row] = await db.insert(environment).values(input).returning();
  return row;
}

/** Resources still owned by an environment. The caller needs these BEFORE the
 *  row is deleted. Afterwards there is no way to find them, because the id
 *  they carry no longer resolves to anything. */
async function listResourcesInEnvironment(
  environmentId: EnvironmentId,
): Promise<{ id: ResourceId; name: string; projectId: ProjectId }[]> {
  return db
    .select({ id: resource.id, name: resource.name, projectId: resource.projectId })
    .from(resource)
    .where(eq(resource.environmentId, environmentId));
}

/** True when some project names this environment as its main one
 *  (`project.environment_id`, a soft pointer with no FK). */
async function isMainEnvironmentOfAProject(environmentId: EnvironmentId): Promise<boolean> {
  const [row] = await db
    .select({ id: project.id })
    .from(project)
    .where(eq(project.environmentId, environmentId))
    .limit(1);
  return row !== undefined;
}

/**
 * Atomic env delete.
 *
 * A project's MAIN environment is refused outright. `project.environment_id`
 * is the pointer every scoped read resolves through, and with it gone the
 * project reports zero resources everywhere while its containers keep
 * running; nothing in the product sets a main pointer back. Deleting the
 * project is what removes its main environment (the `environment.project_id`
 * FK cascades), and that path does not come through here.
 *
 * Resource rows carry the same soft pointer, and they are the dangerous one: a
 * resource left with a dangling `environment_id` matches NO scope query. It is
 * not base (its column is non-null) and its environment no longer exists, so it
 * vanishes from every list and graph while its container keeps running. The
 * delete therefore refuses unless the caller has explicitly accepted what
 * happens to them. `cascade` deletes the rows, and the caller is responsible
 * for having torn down their runtime first.
 */
/**
 * Rename an environment. The SLUG is not touched, and cannot be: it is baked
 * into every scoped runtime name — container suffixes (`web-admin-staging`),
 * internal hostnames (`postgres-staging.<project>.…`), the overlay network,
 * and the `environments.<slug>` key in the project manifest. Changing it would
 * leave every running container orphaned from its row.
 */
/**
 * Patch an environment's own columns.
 *
 * The patch type is the set an operator may set, NOT `Partial<row>`. `slug` is
 * load-bearing (see above) and `projectId` decides ownership; neither belongs
 * behind a generic patch that a future caller could reach through by accident.
 */
export async function updateEnvRecord(input: {
  environmentId: EnvironmentId;
  patch: { name?: string; protected?: boolean };
}): Promise<EnvironmentRecord | undefined> {
  const [row] = await db
    .update(environment)
    .set(input.patch)
    .where(eq(environment.id, input.environmentId))
    .returning();
  return row;
}

export async function deleteEnvRecord(input: {
  environmentId: EnvironmentId;
  organizationId: OrgId;
  /** Delete resources owned by this environment along with it. Without this a
   *  non-empty environment is refused rather than orphaning its rows. */
  cascade?: boolean;
}): Promise<
  { ok: true; id: EnvironmentId } | { ok: false; reason: "not-found" | "has-resources" | "is-main" }
> {
  const owned = await getEnvInOrg(input);
  if (!owned) return { ok: false, reason: "not-found" };

  // Before the emptiness check: a main environment that still owns resources
  // must not answer "confirm the cascade", because the cascade would only be
  // refused here next.
  if (await isMainEnvironmentOfAProject(input.environmentId)) {
    return { ok: false, reason: "is-main" };
  }

  const ownedResources = await listResourcesInEnvironment(input.environmentId);
  if (ownedResources.length > 0 && !input.cascade) {
    return { ok: false, reason: "has-resources" };
  }

  const result = await db.transaction(async (tx) => {
    // Ordered before the environment delete so no row is ever left pointing at
    // an id that has stopped existing, even if the transaction is inspected
    // mid-flight by another connection.
    if (ownedResources.length > 0) {
      await tx.delete(resource).where(eq(resource.environmentId, input.environmentId));
    }

    const [deleted] = await tx
      .delete(environment)
      .where(eq(environment.id, input.environmentId))
      .returning({ id: environment.id });
    return deleted
      ? ({ ok: true, id: deleted.id } as const)
      : ({ ok: false, reason: "not-found" } as const);
  });

  // The env's whole disk subtree (envs/<envId>/: resource homes, volumes,
  // backup staging) goes with the rows. A standalone env (no project) never
  // had a dir. Best-effort like every data-dir removal.
  if (result.ok && owned.projectId) {
    await removeEnvDir(input.organizationId, owned.projectId, input.environmentId);
  }
  return result;
}
