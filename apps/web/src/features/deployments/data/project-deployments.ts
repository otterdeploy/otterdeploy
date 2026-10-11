/**
 * The project Deployments page's rows, as a TanStack DB collection.
 *
 * One collection per filter scope (resource, people, search, window,
 * environment), filled by one `deployment.listByProject` read of up to
 * {@link DEPLOYMENTS_WINDOW} rows. The status views, day grouping and "Show
 * older" then run against that local copy, so flipping between All, Live now,
 * In progress and Failed costs no round trip.
 *
 * Live: the query key sits under `orpc.deployment.listByProject.key()`, which
 * the project and org event streams invalidate when a deploy starts, settles
 * or fails. The poll below is the backstop for a stream that silently died,
 * fast only while something is in flight.
 *
 * The response's summary, serving map and person options travel beside the
 * rows, parked in the query cache under a typed key (same arrangement as the
 * data workbench's rows window, ../../resources/components/postgres/tabs/data/data/rows-window.ts).
 */

import { createCollection } from "@tanstack/db";
import { queryCollectionOptions } from "@tanstack/query-db-collection";
import { queryOptions, skipToken } from "@tanstack/react-query";

import { orpc, queryClient } from "@/shared/server/orpc";

import type {
  DeployWindow,
  ProjectDeployment,
  ProjectDeploymentStats,
  ServingDeployment,
} from "./deployments-search";

import { windowSince } from "./deployments-search";

/** Rows held client-side per scope: the API's own page cap. A scope bigger
 *  than this says so (see `DeploymentsMeta.total`) rather than pretending. */
const DEPLOYMENTS_WINDOW = 500;

export interface DeploymentsScope {
  projectId: string;
  environmentId: string | undefined;
  environmentIsMain: boolean;
  resourceId: string | undefined;
  people: readonly string[];
  automatic: boolean;
  q: string;
  window: DeployWindow;
}

export interface DeploymentsMeta {
  /** Rows matching the scope, which can exceed what the collection holds. */
  total: number;
  stats: ProjectDeploymentStats;
  serving: ServingDeployment[];
  facets: {
    people: { name: string; image: string | null; count: number }[];
    automatic: number;
  };
}

function scopeKey(scope: DeploymentsScope): string {
  return JSON.stringify([
    scope.projectId,
    scope.environmentId ?? "",
    scope.environmentIsMain,
    scope.resourceId ?? "",
    [...scope.people].toSorted(),
    scope.automatic,
    scope.q,
    scope.window,
  ]);
}

/** The typed cache entry the summary, serving map and person options live
 *  in. `skipToken`: never fetched on its own, only written by the rows' read
 *  and subscribed to by the page. */
export function deploymentsMetaOptions(scope: DeploymentsScope) {
  return queryOptions<DeploymentsMeta>({
    queryKey: ["project-deployments-meta", scopeKey(scope)],
    queryFn: skipToken,
  });
}

const IN_FLIGHT = new Set<ProjectDeployment["status"]>(["pending", "building", "starting"]);

function buildCollection(scope: DeploymentsScope) {
  const key = scopeKey(scope);
  return createCollection(
    queryCollectionOptions({
      id: `project-deployments:${key}`,
      // The scope itself is the key's last segment (people pre-sorted by the
      // caller's normalisation in `projectDeploymentsCollection`).
      queryKey: [...orpc.deployment.listByProject.key(), scope.projectId, "page", scope],
      queryFn: async (): Promise<ProjectDeployment[]> => {
        const out = await orpc.deployment.listByProject.call({
          projectId: scope.projectId,
          environmentId: scope.environmentId,
          environmentIsMain: scope.environmentIsMain,
          resourceId: scope.resourceId,
          people: scope.people.length > 0 ? [...scope.people] : undefined,
          automatic: scope.automatic || undefined,
          q: scope.q || undefined,
          since: windowSince(scope.window),
          limit: DEPLOYMENTS_WINDOW,
          offset: 0,
        });
        queryClient.setQueryData(deploymentsMetaOptions(scope).queryKey, {
          total: out.total,
          stats: out.stats,
          serving: out.serving,
          facets: out.facets,
        });
        return out.items;
      },
      queryClient,
      getKey: (d) => d.id,
      staleTime: 10_000,
      refetchInterval: (query) =>
        query.state.data?.some((d) => IN_FLIGHT.has(d.status)) ? 5_000 : 30_000,
    }),
  );
}

const collections = new Map<string, ReturnType<typeof buildCollection>>();

/** The collection for one scope, built once and reused (a scope visited again
 *  renders from what it already holds while it refreshes). */
export function projectDeploymentsCollection(scope: DeploymentsScope) {
  const key = scopeKey(scope);
  const existing = collections.get(key);
  if (existing) return existing;
  const created = buildCollection({ ...scope, people: [...scope.people].toSorted() });
  collections.set(key, created);
  return created;
}
