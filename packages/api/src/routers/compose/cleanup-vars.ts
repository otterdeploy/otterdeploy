import type { ProjectId, ResourceId } from "@otterdeploy/shared/id";
import type { RequestLogger } from "evlog";

import { db } from "@otterdeploy/db";
import {
  databaseResource,
  projectEnvVar,
  resource,
  serviceEnvVar,
} from "@otterdeploy/db/schema/project";
/**
 * On compose-stack deletion, remove the LEGACY project variables the stack
 * seeded before stacks had their own scope (see cleanupOrphanedComposeVars),
 * but ONLY the ones no surviving resource still references. Project variables
 * are shared and reach a container only through an explicit reference
 * (`${{project.KEY}}` in a service/database, or `${KEY}` in another compose
 * file, never an auto-cascade, see lib/variables/resolver.ts), so a key that
 * nothing references is genuinely orphaned and safe to drop.
 *
 * Without this, deleting a stack left its `${VAR}` keys stranded in the project
 * bag forever, surfacing as "variables for resources that no longer exist" in
 * the reference picker and the Variables page.
 */
import { and, eq, ne } from "drizzle-orm";

import { decryptEnvValue } from "../../lib/env-crypto";
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

  // Other compose stacks (inline): their `${VAR}` refs.
  const stacks = await listComposeRecords(projectId);
  for (const s of stacks) {
    if (s.resource.id === excludeResourceId) continue;
    const content = s.compose.composeContent;
    if (!content) continue; // git stacks: refs live in the repo, can't parse
    const parsed = parseCompose(content);
    if (parsed.isErr()) continue;
    for (const ref of collectVarRefs(parsed.value)) referenced.add(ref.name);
  }

  // Services: scope-ref tokens in their env values. (A deleted stack's child
  // service rows are already gone by the time this runs, so they don't count.)
  const serviceEnvRows = await db
    .select({ value: serviceEnvVar.value, sealed: serviceEnvVar.sealed })
    .from(serviceEnvVar)
    .innerJoin(resource, eq(resource.id, serviceEnvVar.serviceResourceId))
    .where(and(eq(resource.projectId, projectId), ne(resource.id, excludeResourceId)));
  for (const row of serviceEnvRows) {
    // Encrypted at rest (od-3pp7). Sealed rows are skipped: this scan could
    // never see into their ciphertext before encryption either.
    if (row.sealed) continue;
    extractScopeRefs(await decryptEnvValue(row.value), referenced);
  }

  // Databases: scope-ref tokens in extraEnv values.
  const dbRows = await db
    .select({
      extraEnv: databaseResource.extraEnv,
      id: databaseResource.resourceId,
    })
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
 * Delete the project variables a now-deleted compose stack left behind from
 * before stacks had a scope of their own, and nothing else.
 *
 * Stacks used to seed their `${VAR}` values into the shared project bag. The
 * stack_env_var migration COPIED each stack-local one into the stack's own
 * variables, ciphertext verbatim, and left the project row in place (a
 * service could still reach it through `${{project.KEY}}`). A project row
 * whose stored value is still byte-identical to this stack's copy is that
 * leftover; it goes, unless something else still references the key.
 *
 * Anything else is the project's, never a stack's to delete: a key the stack
 * only read through the project bag, a project value an operator has edited
 * since (re-encryption makes the stored value differ), a key another resource
 * references. Before stacks had their own variables, this removed every key the stack's file named
 * that nothing else referenced, which deleted project variables an operator
 * had set by hand.
 *
 * @param ownRows the deleted stack's own variables as STORED (read before its
 *   rows cascaded away)
 */
export async function cleanupOrphanedComposeVars(
  args: {
    projectId: ProjectId;
    deletedResourceId: ResourceId;
    ownRows: ReadonlyArray<{ key: string; value: string }>;
  },
  log: RequestLogger,
): Promise<void> {
  if (args.ownRows.length === 0) return;

  const project = await getProjectById(args.projectId);
  const environmentId = project?.environmentId;
  if (!environmentId) return;

  const projectRows = await db
    .select({ key: projectEnvVar.key, value: projectEnvVar.value })
    .from(projectEnvVar)
    .where(
      and(
        eq(projectEnvVar.projectId, args.projectId),
        eq(projectEnvVar.environmentId, environmentId),
      ),
    );
  const storedByKey = new Map(projectRows.map((r) => [r.key, r.value]));
  const leftovers = args.ownRows
    .filter((own) => storedByKey.get(own.key) === own.value)
    .map((own) => own.key);
  if (leftovers.length === 0) return;

  const referenced = await collectReferencedKeys(args.projectId, args.deletedResourceId);

  const removed: string[] = [];
  for (const key of leftovers) {
    if (referenced.has(key)) continue;
    await deleteProjectEnvVar({
      scope: { projectId: args.projectId, environmentId },
      key,
    });
    removed.push(key);
  }
  if (removed.length > 0) {
    log.set({
      composeVarCleanup: { resourceId: args.deletedResourceId, removed },
    });
  }
}
