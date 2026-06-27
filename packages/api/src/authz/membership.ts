/**
 * Deployment-protection authorization lookups.
 *
 * The authorizing org for a protected deployment is derived, never stored
 * twice: domain → proxyRoute → project.organizationId. Membership is the
 * single gate — any member of the owning org may view the deployment
 * (role-granular policies are a later refinement).
 *
 * See docs/designs/deployment-protection.md §7.
 */

import { db } from "@otterdeploy/db";
import { member } from "@otterdeploy/db/schema/auth";
import { project } from "@otterdeploy/db/schema/project";
import { and, eq } from "drizzle-orm";

import { getProxyRouteByDomain } from "../caddy/queries";

export interface DomainOrg {
  orgId: string;
  projectId: string;
}

/** Resolve the org that authorizes a protected deployment domain. Returns
 *  null when the domain is unknown OR not protection-enabled — callers
 *  treat null as "no gate, allow through". */
export async function resolveProtectedDomainOrg(domain: string): Promise<DomainOrg | null> {
  const route = await getProxyRouteByDomain(domain);
  if (!route?.protected) return null;

  const [proj] = await db
    .select({ orgId: project.organizationId })
    .from(project)
    .where(eq(project.id, route.projectId))
    .limit(1);
  if (!proj) return null;

  return { orgId: proj.orgId, projectId: route.projectId };
}

/** True when the user is a current member of the org. */
export async function isOrgMember(userId: string, orgId: string): Promise<boolean> {
  const [row] = await db
    .select({ userId: member.userId })
    .from(member)
    .where(and(eq(member.userId, userId), eq(member.organizationId, orgId)))
    .limit(1);
  return Boolean(row);
}
