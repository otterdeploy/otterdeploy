/**
 * Whether a route renders behind the auth wall.
 *
 * Two independent switches decide this, and the rule for combining them is the
 * whole point of the module: the route's own `protected` column, and the floor
 * declared by the environment the route's resource belongs to.
 *
 * It is an OR, never an AND, and the direction matters in both cases:
 *
 *   - An environment turning private must not be able to leave an already
 *     locked route open, so the floor can only ever ADD protection.
 *   - An environment turning public again must not silently expose a route the
 *     operator locked deliberately, so lowering the floor leaves the route's
 *     own switch untouched.
 *
 * The consequence is that "private" is not a toggle whose two positions are
 * symmetric. Turning it on protects everything; turning it off restores each
 * route to whatever it independently said, which is the only behaviour that
 * cannot surprise someone into publishing something.
 */

import type { ProxyRouteId } from "@otterdeploy/shared/id";

export function isRouteProtected(
  route: { id: ProxyRouteId; protected: boolean },
  protectedEnvironmentRoutes: ReadonlySet<ProxyRouteId>,
): boolean {
  return route.protected || protectedEnvironmentRoutes.has(route.id);
}
