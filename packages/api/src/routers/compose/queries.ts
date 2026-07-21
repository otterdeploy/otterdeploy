import type {
  ComposeExposed,
  ComposeFile,
  ComposeServiceSummary,
} from "@otterdeploy/shared/compose";
import type { GitRepoId, ProjectId, ResourceId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { composeResource, resource } from "@otterdeploy/db/schema/project";
/**
 * DB ops for `type: compose` resources. A compose resource is a `resource`
 * row (type=compose) + a `compose_resource` row holding the file and derived
 * summary. See docs/designs/compose.md.
 */
import { and, asc, eq } from "drizzle-orm";

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
    const r = o as Record<string, unknown>;
    const code = typeof r.code === "string" ? r.code : null;
    const constraint =
      (typeof r.constraint_name === "string" && r.constraint_name) ||
      (typeof r.constraint === "string" && r.constraint) ||
      null;
    return code || constraint ? { code, constraint } : null;
  };
  return (
    read(err) ??
    read(err && typeof err === "object" ? (err as { cause?: unknown }).cause : null) ?? {
      code: null,
      constraint: null,
    }
  );
}

/**
 * Map a Postgres unique-violation on a `service_resource` constraint to one
 * actionable line, or null when the error is anything else (let the caller
 * surface it as-is). Without this, a compose stack whose inner service name /
 * internal hostname / public domain collides with an existing resource dumps
 * the raw `Failed query: insert into "service_resource" …` INSERT — bind params
 * and all — into the user-facing deploy log. `label` is the compose service key
 * the user controls in their file (e.g. "waves").
 */
export function friendlyServiceCollisionMessage(err: unknown, label: string): string | null {
  const { code, constraint } = pgErrorInfo(err);
  if (code !== "23505") return null;
  switch (constraint) {
    case "service_resource_service_name_unique":
      return `a service named "${label}" already exists in this project — rename the compose service, or remove the standalone service that owns that name.`;
    case "service_resource_network_hostname_unique":
      return `a service with the internal hostname "${label}" already exists in this project — rename the compose service, or remove the standalone service using that name.`;
    case "service_resource_public_domain_unique":
      return `the public domain for "${label}" is already in use by another service — change the exposed domain.`;
    default:
      return null;
  }
}

export async function createComposeRecord(input: {
  projectId: ProjectId;
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
}): Promise<ComposeRecord> {
  try {
    return await db.transaction(async (tx) => {
      const [res] = await tx
        .insert(resource)
        .values({
          projectId: input.projectId,
          name: input.name,
          type: "compose",
          status: "valid",
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

      return { resource: res, compose: comp };
    });
  } catch (err) {
    // The stack name (swarm namespace) is globally unique. Two projects that
    // share a slug — e.g. a "store" project in two different orgs — both derive
    // the same stackName for a given template and collide here. Translate the
    // raw Postgres/Drizzle dump into one actionable line; leaving it raw is what
    // floods the client toast with the whole failing INSERT + bind params.
    const { code, constraint } = pgErrorInfo(err);
    if (code === "23505" && constraint === "compose_resource_stack_name_unique") {
      throw new Error(
        `A stack named "${input.stackName}" already exists. Stack names are unique across every project — rename the project or the resource, or open the existing stack.`,
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

export async function listComposeRecords(projectId: ProjectId): Promise<ComposeRecord[]> {
  return db
    .select({ resource, compose: composeResource })
    .from(resource)
    .innerJoin(composeResource, eq(composeResource.resourceId, resource.id))
    .where(and(eq(resource.projectId, projectId), eq(resource.type, "compose")))
    .orderBy(asc(resource.createdAt));
}

/** Replace the stack's `exposed` (service:port→domain) list. The caller
 *  re-runs the Caddy domain reconcile afterwards from the refreshed record. */
export async function updateComposeExposed(input: {
  resourceId: ResourceId;
  exposed: ComposeExposed[];
}): Promise<void> {
  await db
    .update(composeResource)
    .set({ exposed: input.exposed })
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
