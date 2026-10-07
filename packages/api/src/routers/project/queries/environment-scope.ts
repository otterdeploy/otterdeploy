import type { EnvironmentId, ProjectId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { project, resource } from "@otterdeploy/db/schema/project";
import { eq, isNull, or } from "drizzle-orm";

/**
 * Rows owned by one environment scope.
 *
 * A NULL `environment_id` means the project's MAIN environment. Resources
 * pre-date environment scoping and were all created unstamped, so main has to
 * own them or they'd be invisible everywhere: but that equivalence holds ONLY
 * for main, which is why `isMain` is a required argument rather than something
 * inferred from `environmentId` being absent.
 *
 * That inference is exactly what was wrong before: this took a lone optional
 * `environmentId` and treated "not supplied" as "the main environment", so
 * every caller that simply forgot to pass one silently got the `IS NULL` scope
 * and looked like it was working. Making both facts explicit means a caller
 * cannot express "some environment, I don't know which".
 *
 * This is what stops staging's resources appearing in production's graph and
 * vice versa. Without it every environment renders every environment's
 * resources: the symptom that started this work.
 */
export function inEnvironmentScope(scope: ResourceScope) {
  // Reverse lookups (container name → resource) must span environments or a
  // staging container's logs resolve to nothing. Spelled as a literal rather
  // than an omitted argument so it reads as a decision at the call site.
  if (scope === "all") return undefined;
  const owned = eq(resource.environmentId, scope.environmentId);
  // Main additionally owns every unstamped row; a non-main environment owns
  // only what explicitly names it.
  return scope.isMain ? or(owned, isNull(resource.environmentId)) : owned;
}

/**
 * Which environment a read is scoped to. `isMain` is the project's own
 * `environment_id` pointer matching this environment: see resolveEnvironmentScope.
 */
export interface EnvironmentScopeInput {
  environmentId: EnvironmentId;
  isMain: boolean;
}

/**
 * One environment, or deliberately every one of them. `"all"` is for reverse
 * lookups that map a container/service NAME back to a resource: those must see
 * every environment or a non-main container resolves to nothing. It is never
 * correct for a list the operator is looking at.
 */
export type ResourceScope = EnvironmentScopeInput | "all";

/**
 * Turn "this project, maybe this environment" into a scope.
 *
 * Callers hold a project row and an OPTIONAL environment id (the client sends
 * one once the operator has picked from the switcher; deep links, internal
 * callers and the CLI often don't). Absent means the project's main
 * environment (the same thing the UI defaults to) so every caller lands on a
 * real environment id rather than the old implicit `IS NULL`.
 *
 * Returns null only for a project with no `environment_id` pointer at all,
 * which project.create has always set; callers treat that as "no resources".
 */
export function resolveEnvironmentScope(
  projectRow: { environmentId: EnvironmentId | null },
  requested?: EnvironmentId | null,
): EnvironmentScopeInput | null {
  const main = projectRow.environmentId;
  if (!main) return null;
  const environmentId = requested ?? main;
  return { environmentId, isMain: environmentId === main };
}

/**
 * {@link resolveEnvironmentScope} for callers that hold only a projectId and
 * would otherwise re-query the project row by hand.
 */
export async function resolveProjectEnvironmentScope(
  projectId: ProjectId,
  requested?: EnvironmentId | null,
): Promise<EnvironmentScopeInput | null> {
  const [row] = await db
    .select({ environmentId: project.environmentId })
    .from(project)
    .where(eq(project.id, projectId))
    .limit(1);
  return row ? resolveEnvironmentScope(row, requested) : null;
}
