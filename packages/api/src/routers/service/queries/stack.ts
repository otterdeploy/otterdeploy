/**
 * Lookups behind the stack-scoped reference form.
 *
 * `${{stack.db.HOST}}` and `${{autumn.db.HOST}}` address a compose stack's
 * child by its COMPOSE SERVICE KEY, not by resource name — the key is the one
 * identifier that survives the name-fallback suffixes and hostname renames a
 * second instance of a template forces. Split from ./env.ts, which is at its
 * line cap.
 */
import type { ProjectId, ResourceId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { resource, serviceResource } from "@otterdeploy/db/schema/project";
import { and, eq } from "drizzle-orm";

import type { ResourceRow } from ".";

/**
 * A compose stack (type "compose") in the project, by resource name. The
 * absolute stack-scoped ref form (`${{autumn.db.HOST}}`) resolves its first
 * segment through this.
 */
export async function getComposeStackByName(
  projectId: ProjectId,
  name: string,
): Promise<ResourceRow | undefined> {
  const [row] = await db
    .select()
    .from(resource)
    .where(
      and(eq(resource.projectId, projectId), eq(resource.name, name), eq(resource.type, "compose")),
    )
    .limit(1);
  return row;
}

/**
 * A stack child by its COMPOSE service key (`db`, `server`). The addressing
 * used by stack-scoped refs: stable across resource-name fallbacks and
 * hostname renames, which the child's other identifiers are not.
 */
export async function getStackChildByComposeService(
  projectId: ProjectId,
  stackResourceId: ResourceId,
  composeService: string,
): Promise<ResourceRow | undefined> {
  const [row] = await db
    .select({ resource })
    .from(resource)
    .innerJoin(serviceResource, eq(serviceResource.resourceId, resource.id))
    .where(
      and(
        eq(resource.projectId, projectId),
        eq(serviceResource.stackId, stackResourceId),
        eq(serviceResource.composeService, composeService),
      ),
    )
    .limit(1);
  return row?.resource;
}

/**
 * How stack-scoped refs address a resource, when it is a stack child: the
 * owning stack (id + resource name) and the child's compose service key.
 * Undefined for standalone services, databases, and pre-column children whose
 * `compose_service` has not healed yet — those are addressable by resource
 * name alone.
 */
export interface StackRefIdentity {
  stackId: ResourceId;
  stackName: string;
  composeService: string;
}

export async function getStackRefIdentity(
  resourceId: ResourceId,
): Promise<StackRefIdentity | undefined> {
  const [row] = await db
    .select({
      stackId: serviceResource.stackId,
      stackName: resource.name,
      composeService: serviceResource.composeService,
    })
    .from(serviceResource)
    // Inner join on the STACK's resource row: a standalone service (stackId
    // NULL) drops out here rather than needing a second check.
    .innerJoin(resource, eq(resource.id, serviceResource.stackId))
    .where(eq(serviceResource.resourceId, resourceId))
    .limit(1);
  if (!row?.stackId || !row.composeService) return undefined;
  return { stackId: row.stackId, stackName: row.stackName, composeService: row.composeService };
}

/** A compose stack's resource name by id: the first segment of the absolute
 *  stack-scoped ref form (`${{autumn.db.HOST}}`), for the reverse lookup a
 *  self-reference check needs. Null when the id is not a stack in the project. */
export async function getStackResourceName(
  projectId: ProjectId,
  stackResourceId: ResourceId,
): Promise<string | null> {
  const [row] = await db
    .select({ name: resource.name })
    .from(resource)
    .where(
      and(
        eq(resource.projectId, projectId),
        eq(resource.id, stackResourceId),
        eq(resource.type, "compose"),
      ),
    )
    .limit(1);
  return row?.name ?? null;
}
