/**
 * Deployment-protection authorization lookups.
 *
 * The authorizing org for a protected deployment is derived, never stored
 * twice: domain → proxyRoute → project.organizationId. Membership is the
 * single gate: any member of the owning org may view the deployment
 * (role-granular policies are a later refinement).
 *
 * See docs/designs/deployment-protection.md §7.
 */

import type { ResourceId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { environment, project, resource } from "@otterdeploy/db/schema/project";
import { eq } from "drizzle-orm";

import { getProxyRouteByDomain } from "../caddy/queries";
import { serviceRoutesOf } from "../caddy/service-protection";

export interface DomainOrg {
  orgId: string;
  projectId: string;
  /** The route's access-PIN hash (null = PIN method off). Carried here so
   *  the forward_auth hot path and the wall page get it from the route row
   *  they already load, no second query. */
  accessPinHash: string | null;
}

/** Whether the environment that owns `resourceId` is private. A route with
 *  no resource (the control-plane route) belongs to no environment. */
async function inProtectedEnvironment(resourceId: ResourceId | null): Promise<boolean> {
  if (!resourceId) return false;
  const [row] = await db
    .select({ protected: environment.protected })
    .from(resource)
    .innerJoin(environment, eq(resource.environmentId, environment.id))
    .where(eq(resource.id, resourceId))
    .limit(1);
  return row?.protected ?? false;
}

/** Resolve the org that authorizes a protected deployment domain. Returns
 *  null when the domain is unknown OR not protection-enabled. Callers
 *  treat null as "no gate, allow through".
 *
 *  "Protection-enabled" is the same OR the edge renders with (see
 *  caddy/route-protection.ts): the switch on any of the service's hosts, or
 *  a private environment, so the authorizer gates exactly the routes the
 *  edge sends to it. */
export async function resolveProtectedDomainOrg(domain: string): Promise<DomainOrg | null> {
  const route = await getProxyRouteByDomain(domain);
  if (!route) return null;
  // Protection and its PIN are per SERVICE: any of the service's hosts being
  // protected protects them all, and the PIN set from whichever host the
  // settings card showed opens every one of them.
  const service = await serviceRoutesOf(route);
  const serviceProtected = service.some((r) => r.protected);
  if (!serviceProtected && !(await inProtectedEnvironment(route.resourceId))) return null;
  const accessPinHash =
    route.accessPinHash ?? service.find((r) => r.accessPinHash !== null)?.accessPinHash ?? null;

  const [proj] = await db
    .select({ orgId: project.organizationId })
    .from(project)
    .where(eq(project.id, route.projectId))
    .limit(1);
  if (!proj) return null;

  return { orgId: proj.orgId, projectId: route.projectId, accessPinHash };
}
