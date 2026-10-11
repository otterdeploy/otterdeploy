/**
 * The URL's filters as a fetch scope, and as the words the summary leads
 * with ("Last 7 days · web · Ada, automatic · matching “tax”").
 */

import type { DeploymentsSearch } from "../data/deployments-search";
import type { DeploymentsScope } from "../data/project-deployments";

import { windowLabel } from "../data/deployments-search";

export function scopeFromSearch(
  projectId: string,
  env: { id: string | undefined; isMain: boolean },
  search: DeploymentsSearch,
): DeploymentsScope {
  return {
    projectId,
    environmentId: env.id,
    environmentIsMain: env.isMain,
    resourceId: search.resource,
    people: search.people ?? [],
    automatic: search.automatic ?? false,
    q: search.q ?? "",
    window: search.window ?? "7d",
  };
}

export function scopeText(scope: DeploymentsScope, resourceName: string | undefined): string {
  const people = [...scope.people, ...(scope.automatic ? ["automatic"] : [])];
  return [
    windowLabel(scope.window),
    resourceName,
    people.length > 0 ? people.join(", ") : undefined,
    scope.q ? `matching “${scope.q}”` : undefined,
  ]
    .filter(Boolean)
    .join(" · ");
}
