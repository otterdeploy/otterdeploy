/**
 * What a route's raw directives may dial on the edge's shared networks
 * the project's own workloads, by the minted names the platform
 * runs them as, and nothing else Docker would answer for. See
 * caddy/directive-scope.ts for the rules this feeds.
 */

import type { ProjectId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import {
  composeResource,
  databaseResource,
  environment,
  project,
  resource,
  serviceResource,
} from "@otterdeploy/db/schema/project";
import { proxyRoute } from "@otterdeploy/db/schema/proxy-route";
import { eq } from "drizzle-orm";

import type { ProjectUpstreamNames, RouteDirectiveScope } from "../../caddy/directive-scope";

import { systemHostLookup } from "../../caddy/directive-scope";
import { controlPlaneEgressDenylist } from "../../lib/egress-denylist";
import { egressAllowlist } from "../../lib/egress-options";
import { composeSwarmServiceName } from "../../stack/compose";
import { buildContainerName } from "./view-helpers";

/**
 * Every base name the project's services, compose children and databases run
 * as, its databases' `*.otterdeploy.internal` aliases, and its routes' upstream
 * hosts (already the runtime name, preview and environment suffix included).
 * Short aliases (resource names, a service's `internalHostname`) are left out
 * on purpose: they are not unique across the networks the edge sits on.
 */
async function listProjectUpstreamNames(projectId: ProjectId): Promise<ProjectUpstreamNames> {
  const [projectRow, services, composes, databases, environments, routes] = await Promise.all([
    db.select({ slug: project.slug }).from(project).where(eq(project.id, projectId)).limit(1),
    db
      .select({ serviceName: serviceResource.serviceName })
      .from(resource)
      .innerJoin(serviceResource, eq(serviceResource.resourceId, resource.id))
      .where(eq(resource.projectId, projectId)),
    db
      .select({ stackName: composeResource.stackName, services: composeResource.services })
      .from(resource)
      .innerJoin(composeResource, eq(composeResource.resourceId, resource.id))
      .where(eq(resource.projectId, projectId)),
    db
      .select({
        name: resource.name,
        engine: databaseResource.engine,
        serviceName: databaseResource.serviceName,
        internalHostname: databaseResource.internalHostname,
      })
      .from(resource)
      .innerJoin(databaseResource, eq(databaseResource.resourceId, resource.id))
      .where(eq(resource.projectId, projectId)),
    db
      .select({ slug: environment.slug })
      .from(environment)
      .where(eq(environment.projectId, projectId)),
    db
      .select({ upstreamHost: proxyRoute.upstreamHost })
      .from(proxyRoute)
      .where(eq(proxyRoute.projectId, projectId)),
  ]);
  const projectSlug = projectRow[0]?.slug ?? projectId;
  const bases = [
    ...services.map((row) => row.serviceName),
    ...composes.flatMap((row) =>
      row.services.map((child) => composeSwarmServiceName(row.stackName, child.name)),
    ),
    ...databases.flatMap((row) => [
      buildContainerName({
        engine: row.engine,
        projectSlug,
        resourceName: row.name,
        stored: row.serviceName,
      }),
      row.internalHostname,
    ]),
    ...routes.map((row) => row.upstreamHost),
  ];
  return {
    bases: new Set(bases.map((name) => name.toLowerCase())),
    environments: new Set(environments.map((row) => row.slug.toLowerCase())),
  };
}

/** Everything parseRouteDirectives needs to judge one project's directives. */
export async function loadRouteDirectiveScope(projectId: ProjectId): Promise<RouteDirectiveScope> {
  const [own, allowAddresses, denylist] = await Promise.all([
    listProjectUpstreamNames(projectId),
    egressAllowlist(),
    controlPlaneEgressDenylist(),
  ]);
  return {
    own,
    allowAddresses,
    denyAddresses: denylist.blockedAddresses,
    denyHosts: denylist.blockedHosts,
    lookup: systemHostLookup,
  };
}
