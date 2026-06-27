import type { EnvironmentId, ProjectId, ResourceId } from "@otterdeploy/shared/id";
import type { RequestLogger } from "evlog";

import { db } from "@otterdeploy/db";
import { databaseResource, resource, serviceEnvVar } from "@otterdeploy/db/schema/project";
/**
 * On compose-stack deletion, remove the project variables the stack seeded
 * (its `${VAR}` values, written to the shared project bag at create time) —
 * but ONLY the ones no surviving resource still references. Project variables
 * are shared and reach a container only through an explicit reference
 * (`${{project.KEY}}` in a service/database, or `${KEY}` in another compose
 * file — never an auto-cascade, see lib/variables/resolver.ts), so a key that
 * nothing references is genuinely orphaned and safe to drop.
 *
 * Without this, deleting a stack left its `${VAR}` keys stranded in the project
 * bag forever — surfacing as "variables for resources that no longer exist" in
 * the reference picker and the Variables page.
 */
import { and, eq, ne } from "drizzle-orm";

import { parseCompose } from "../../stack/compose";
import { deleteProjectEnvVar, getProjectById } from "../project/queries";
import { collectVarRefs } from "./env";
import { listComposeRecords } from "./queries";

// `${{project.KEY}}` / `${{environment.KEY}}` reference tokens inside a
// service or database env value.
const SCOPE_REF_RE = /\$\{\{\s*(?:project|environment)\.([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;

function extractScopeRefs(value: string, into: Set<string>): void {
  for (const m of value.matchAll(SCOPE_REF_RE)) {
    if (m[1]) into.add(m[1]);
  }
}

/**
 * Keys still referenced by any resource OTHER than `excludeResourceId`:
 *   - other inline compose stacks  → their `${VAR}` refs
 *   - services                     → `${{project.KEY}}` in env values
 *   - databases                    → `${{project.KEY}}` in extraEnv values
 */
async function collectReferencedKeys(
  projectId: ProjectId,
  excludeResourceId: ResourceId,
): Promise<Set<string>> {
  const referenced = new Set<string>();

  // Other compose stacks (inline) — their `${VAR}` refs.
  const stacks = await listComposeRecords(projectId);
  for (const s of stacks) {
    if (s.resource.id === excludeResourceId) continue;
    const content = s.compose.composeContent;
    if (!content) continue; // git stacks: refs live in the repo, can't parse
    const parsed = parseCompose(content);
    if (parsed.isErr()) continue;
    for (const ref of collectVarRefs(parsed.value)) referenced.add(ref.name);
  }

  // Services — scope-ref tokens in their env values. (A deleted stack's child
  // service rows are already gone by the time this runs, so they don't count.)
  const serviceEnvRows = await db
    .select({ value: serviceEnvVar.value })
    .from(serviceEnvVar)
    .innerJoin(resource, eq(resource.id, serviceEnvVar.serviceResourceId))
    .where(and(eq(resource.projectId, projectId), ne(resource.id, excludeResourceId)));
  for (const row of serviceEnvRows) extractScopeRefs(row.value, referenced);

  // Databases — scope-ref tokens in extraEnv values.
  const dbRows = await db
    .select({ extraEnv: databaseResource.extraEnv, id: databaseResource.resourceId })
    .from(databaseResource)
    .innerJoin(resource, eq(resource.id, databaseResource.resourceId))
    .where(and(eq(resource.projectId, projectId), ne(resource.id, excludeResourceId)));
  for (const row of dbRows) {
    for (const value of Object.values(row.extraEnv ?? {})) {
      extractScopeRefs(value, referenced);
    }
  }

  return referenced;
}

/**
 * Delete the orphaned project variables a now-deleted compose stack seeded.
 *
 * @param composeContent the stack's stored inline YAML (null for git stacks →
 *   we can't know which keys it seeded, so nothing is removed)
 */
export async function cleanupOrphanedComposeVars(
  args: {
    projectId: ProjectId;
    deletedResourceId: ResourceId;
    composeContent: string | null;
  },
  log: RequestLogger,
): Promise<void> {
  if (!args.composeContent) return;
  const parsed = parseCompose(args.composeContent);
  if (parsed.isErr()) return;
  const seededKeys = collectVarRefs(parsed.value).map((r) => r.name);
  if (seededKeys.length === 0) return;

  const project = await getProjectById(args.projectId);
  const environmentId = project?.environmentId as EnvironmentId | null | undefined;
  if (!environmentId) return;

  const referenced = await collectReferencedKeys(args.projectId, args.deletedResourceId);

  const removed: string[] = [];
  for (const key of seededKeys) {
    if (referenced.has(key)) continue;
    await deleteProjectEnvVar({
      scope: { projectId: args.projectId, environmentId },
      key,
    });
    removed.push(key);
  }
  if (removed.length > 0) {
    log.set({ composeVarCleanup: { resourceId: args.deletedResourceId, removed } });
  }
}
