/**
 * Access-PIN management for a protected route (NetBird-style): the operator
 * sets one shared numeric code; anyone who enters it on the wall gets in.
 * Only the argon2 hash is stored (see authz/pin.ts) and only an enabled
 * boolean ever leaves the server. Split out of proxy-routes.ts (same pattern
 * as proxy-route-certs.ts).
 */

import type { ProxyRouteId } from "@otterdeploy/shared/id";

import { Result } from "better-result";

import type { OrgRef } from "../scopes";

import { hashPin } from "../../authz/pin";
import { updateProxyRoute } from "../../caddy/queries";
import { ProxyRouteNotFoundError } from "./errors";
import { getRouteInOrg } from "./queries";

/** Whether the route has an access PIN configured (settings UI state). */
export async function getRouteAccessPin(
  input: OrgRef & { routeId: ProxyRouteId },
): Promise<Result<{ enabled: boolean }, ProxyRouteNotFoundError>> {
  const route = await getRouteInOrg(input.routeId, input.organizationId);
  if (!route) {
    return Result.err(new ProxyRouteNotFoundError({ routeId: input.routeId }));
  }
  return Result.ok({ enabled: route.accessPinHash !== null });
}

/** Set / rotate / clear the route's access PIN. Stores only the argon2 hash.
 *  No reconcile — the Caddyfile gate is the same forward_auth either way; the
 *  wall and the authz endpoint read the hash live. Rotating or clearing also
 *  revokes every outstanding pin cookie (they're bound to a fingerprint of
 *  the hash they were minted against — see authz/pin.ts). */
export async function setRouteAccessPin(
  input: OrgRef & { routeId: ProxyRouteId; pin: string | null },
): Promise<Result<{ enabled: boolean }, ProxyRouteNotFoundError>> {
  const route = await getRouteInOrg(input.routeId, input.organizationId);
  if (!route) {
    return Result.err(new ProxyRouteNotFoundError({ routeId: input.routeId }));
  }

  const accessPinHash = input.pin === null ? null : await hashPin(input.pin);
  const updated = await updateProxyRoute(input.routeId, { accessPinHash });
  if (!updated) {
    return Result.err(new ProxyRouteNotFoundError({ routeId: input.routeId }));
  }
  return Result.ok({ enabled: updated.accessPinHash !== null });
}
