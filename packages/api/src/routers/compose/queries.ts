import type {
  ComposeExposed,
  ComposeFile,
  ComposeServiceSummary,
} from "@otterdeploy/shared/compose";
import type {
  EnvironmentId,
  GitRepoId,
  OrganizationId,
  ProjectId,
  ResourceId,
  ServerId,
} from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { composeResource, project, resource, stackEnvVar } from "@otterdeploy/db/schema/project";
/**
 * DB ops for `type: compose` resources. A compose resource is a `resource`
 * row (type=compose) + a `compose_resource` row holding the file and derived
 * summary. See docs/designs/compose.md.
 */
import { and, asc, eq, sql } from "drizzle-orm";

import { type HostBindGrants, NO_HOST_BIND_GRANTS } from "../../lib/host-binds";
import { resolveNewResourceEnvironment } from "../project/queries/new-resource-environment";
import { createStackVariableRows, type StackVariableSeed } from "./stack-env";

export interface ComposeRecord {
  resource: typeof resource.$inferSelect;
  compose: typeof composeResource.$inferSelect;
}

/**
 * Read the postgres SQLSTATE + constraint from a thrown DB error. Drizzle
 * wraps postgres-js errors with the SQL text as the outer message and stashes
 * the real PostgresError on `.cause`; depending on the path the diagnostics
 * live on the wrapper or the cause, so we check both.
 */
export function pgErrorInfo(err: unknown): { code: string | null; constraint: string | null } {
  const read = (o: unknown): { code: string | null; constraint: string | null } | null => {
    if (!o || typeof o !== "object") return null;
    const code = "code" in o && typeof o.code === "string" ? o.code : null;
    const constraint =
      ("constraint_name" in o && typeof o.constraint_name === "string" && o.constraint_name) ||
      ("constraint" in o && typeof o.constraint === "string" && o.constraint) ||
      null;
    return code || constraint ? { code, constraint } : null;
  };
  const cause = err && typeof err === "object" && "cause" in err ? err.cause : null;
  return read(err) ?? read(cause) ?? { code: null, constraint: null };
}

/**
 * Map a Postgres unique-violation on a `service_resource` constraint to one
 * actionable line, or null when the error is anything else (let the caller
 * surface it as-is). Without this, a compose stack whose inner service name /
 * internal hostname / public domain collides with an existing resource dumps
 * the raw `Failed query: insert into "service_resource" …` INSERT. Bind params
 * and all: into the user-facing deploy log. `label` is the compose service key
 * the user controls in their file (e.g. "waves").
 */
export function friendlyServiceCollisionMessage(err: unknown, label: string): string | null {
  const { code, constraint } = pgErrorInfo(err);
  if (code !== "23505") return null;
  switch (constraint) {
    case "service_resource_service_name_unique":
      return `a service named "${label}" already exists in this project. Rename the compose service, or remove the standalone service that owns that name.`;
    case "service_resource_network_hostname_unique":
      return `a service with the internal hostname "${label}" already exists in this project. Rename the compose service, or remove the standalone service using that name.`;
    case "service_resource_public_domain_unique":
      return `the public domain for "${label}" is already in use by another service. Change the exposed domain.`;
    default:
      return null;
  }
}

export async function createComposeRecord(input: {
  projectId: ProjectId;
  /** Environment this stack belongs to; NULL is owned by main. */
  environmentId?: EnvironmentId | null;
  name: string;
  source: "inline" | "git";
  composeContent: string | null;
  /** Multi-file inline stack: compose file + supporting files. */
  files?: ComposeFile[];
  gitRepoId?: GitRepoId | null;
  gitRepoUrl?: string | null;
  gitRef?: string | null;
  sourceSubdir?: string | null;
  composePath?: string | null;
  stackName: string;
  services: ComposeServiceSummary[];
  exposed?: ComposeExposed[];
  /** SvglLogo search string carried from the source template; null otherwise. */
  logoBrand?: string | null;
  /** Machine the stack (and, by seeding, each of its children) runs on. Null =
   *  let the scheduler place it. Already narrowed to a server in this org by
   *  lib/placement-seed.ts. */
  placementServerId?: ServerId | null;
  /** The install's `${VAR}` values, written to THIS stack's own variables in
   *  the same transaction as the stack, never to the shared project bag
   * . Empty values are skipped so they fall through. */
  variables?: ReadonlyArray<StackVariableSeed>;
}): Promise<ComposeRecord> {
  // Omitted means main; a supplied one must be this project's. Callers that
  // take one from a request refuse first; this throw is the backstop.
  const resolved = await resolveNewResourceEnvironment(input.projectId, input.environmentId);
  if (resolved.isErr()) throw resolved.error;
  const environmentId = resolved.value;
  try {
    return await db.transaction(async (tx) => {
      const [res] = await tx
        .insert(resource)
        .values({
          projectId: input.projectId,
          environmentId,
          name: input.name,
          type: "compose",
          status: "valid",
          placementServerId: input.placementServerId ?? null,
        })
        .returning();
      if (!res) throw new Error("Failed to create compose resource row");

      const [comp] = await tx
        .insert(composeResource)
        .values({
          resourceId: res.id,
          source: input.source,
          composeContent: input.composeContent ?? null,
          files: input.files ?? [],
          gitRepoId: input.gitRepoId ?? null,
          gitRepoUrl: input.gitRepoUrl ?? null,
          gitRef: input.gitRef ?? null,
          sourceSubdir: input.sourceSubdir ?? null,
          composePath: input.composePath ?? null,
          stackName: input.stackName,
          services: input.services,
          exposed: input.exposed ?? [],
          logoBrand: input.logoBrand ?? null,
        })
        .returning();
      if (!comp) throw new Error("Failed to create compose_resource row");

      const variables = await createStackVariableRows(res.id, input.variables ?? []);
      if (variables.length > 0) await tx.insert(stackEnvVar).values(variables);

      return { resource: res, compose: comp };
    });
  } catch (err) {
    // The stack name (swarm namespace) is globally unique. Two projects that
    // share a slug (e.g. a "store" project in two different orgs) both derive
    // the same stackName for a given template and collide here. Translate the
    // raw Postgres/Drizzle dump into one actionable line; leaving it raw is what
    // floods the client toast with the whole failing INSERT + bind params.
    const { code, constraint } = pgErrorInfo(err);
    if (code === "23505" && constraint === "compose_resource_stack_name_unique") {
      throw new Error(
        `A stack named "${input.stackName}" already exists. Stack names are unique across every project. Rename the project or the resource, or open the existing stack.`,
      );
    }
    throw err;
  }
}

export async function getComposeRecord(
  projectId: ProjectId,
  resourceId: ResourceId,
): Promise<ComposeRecord | null> {
  const [row] = await db
    .select({ resource, compose: composeResource })
    .from(resource)
    .innerJoin(composeResource, eq(composeResource.resourceId, resource.id))
    .where(
      and(
        eq(resource.id, resourceId),
        eq(resource.projectId, projectId),
        eq(resource.type, "compose"),
      ),
    )
    .limit(1);
  return row ?? null;
}

/**
 * The stack, only when its project belongs to `organizationId`. Every compose
 * procedure takes `projectId` + `resourceId` from its input, and the org-
 * scoped builder does not check which organization the project is in: this
 * is that scoping, so a compose procedure only ever reads or changes a stack
 * of the caller's own organization. Null for missing and out-of-scope alike.
 */
export async function getComposeRecordInOrg(
  organizationId: OrganizationId,
  { projectId, resourceId }: { projectId: ProjectId; resourceId: ResourceId },
): Promise<ComposeRecord | null> {
  const [row] = await db
    .select({ resource, compose: composeResource })
    .from(resource)
    .innerJoin(composeResource, eq(composeResource.resourceId, resource.id))
    .innerJoin(project, eq(project.id, resource.projectId))
    .where(
      and(
        eq(resource.id, resourceId),
        eq(resource.projectId, projectId),
        eq(resource.type, "compose"),
        eq(project.organizationId, organizationId),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** The project's stacks, only when the project belongs to `organizationId`
 *  (see getComposeRecordInOrg). */
export async function listComposeRecordsInOrg(
  organizationId: OrganizationId,
  projectId: ProjectId,
): Promise<ComposeRecord[]> {
  return db
    .select({ resource, compose: composeResource })
    .from(resource)
    .innerJoin(composeResource, eq(composeResource.resourceId, resource.id))
    .innerJoin(project, eq(project.id, resource.projectId))
    .where(
      and(
        eq(resource.projectId, projectId),
        eq(resource.type, "compose"),
        eq(project.organizationId, organizationId),
      ),
    )
    .orderBy(asc(resource.createdAt));
}

export async function listComposeRecords(projectId: ProjectId): Promise<ComposeRecord[]> {
  return db
    .select({ resource, compose: composeResource })
    .from(resource)
    .innerJoin(composeResource, eq(composeResource.resourceId, resource.id))
    .where(and(eq(resource.projectId, projectId), eq(resource.type, "compose")))
    .orderBy(asc(resource.createdAt));
}

/** The host-bind grants a stack's row records. Only
 *  `setDockerSocketGrant` below writes the column this reads. */
export function stackHostBindGrants(
  compose: Pick<ComposeRecord["compose"], "dockerSocketGrantedAt">,
): HostBindGrants {
  return { dockerSocket: compose.dockerSocketGrantedAt !== null };
}

/** The grants of the stack a service belongs to; none for a standalone
 *  service or a stack that is gone (`stack_id` is SET NULL on delete). */
export async function loadStackHostBindGrants(stackId: ResourceId | null): Promise<HostBindGrants> {
  if (!stackId) return NO_HOST_BIND_GRANTS;
  const [row] = await db
    .select({ dockerSocketGrantedAt: composeResource.dockerSocketGrantedAt })
    .from(composeResource)
    .where(eq(composeResource.resourceId, stackId))
    .limit(1);
  return row ? stackHostBindGrants(row) : NO_HOST_BIND_GRANTS;
}

/** Record (or clear) an installation administrator's Docker socket grant on
 *  one stack. The caller is the install-admin gated, audited procedure; no
 *  other path writes these columns. */
export async function setDockerSocketGrant(input: {
  resourceId: ResourceId;
  granted: boolean;
  /** The granting install admin; null only if the session carried no user. */
  userId: string | null;
}): Promise<void> {
  await db
    .update(composeResource)
    .set(
      input.granted
        ? { dockerSocketGrantedAt: sql`now()`, dockerSocketGrantedBy: input.userId }
        : { dockerSocketGrantedAt: null, dockerSocketGrantedBy: null },
    )
    .where(eq(composeResource.resourceId, input.resourceId));
}

/** Replace an inline stack's compose YAML + its re-parsed service summary (and,
 *  for a multi-file stack, the matching file entry). The caller keeps the
 *  project manifest in lockstep and the change takes effect on redeploy. */
export async function updateComposeContent(input: {
  resourceId: ResourceId;
  composeContent: string;
  services: ComposeServiceSummary[];
  files?: ComposeFile[];
}): Promise<void> {
  await db
    .update(composeResource)
    .set({
      composeContent: input.composeContent,
      services: input.services,
      ...(input.files ? { files: input.files } : {}),
    })
    .where(eq(composeResource.resourceId, input.resourceId));
}

export async function deleteComposeRecord(
  projectId: ProjectId,
  resourceId: ResourceId,
): Promise<boolean> {
  // compose_resource cascades from resource; deleting the resource is enough.
  const [row] = await db
    .delete(resource)
    .where(
      and(
        eq(resource.id, resourceId),
        eq(resource.projectId, projectId),
        eq(resource.type, "compose"),
      ),
    )
    .returning({ id: resource.id });
  return Boolean(row);
}
