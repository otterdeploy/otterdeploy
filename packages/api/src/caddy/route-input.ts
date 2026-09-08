import type { ProxyRouteId } from "@otterdeploy/shared/id";

import type { ProxyRouteInput } from "./builder";
import type { ProxyRouteRecord } from "./queries";

import { isRouteProtected } from "./route-protection";

/** Map a DB proxy-route row onto the builder's route-input shape. Shared by
 *  the live reconcile pass and the read-only per-project render so both
 *  surfaces stay byte-identical.
 *
 *  `envProtected` carries the ids of routes sitting in a private environment.
 *  It is passed in rather than looked up here so all three render paths run
 *  the same single query, and so the read-only views show the gate the live
 *  reconcile would actually emit: a "why is this public?" answered from the
 *  rendered config has to be the truth, not a version of it missing the
 *  environment's floor. */
export function toRouteInput(
  r: ProxyRouteRecord,
  envProtected: ReadonlySet<ProxyRouteId>,
): ProxyRouteInput {
  return {
    projectId: r.projectId,
    type: r.type,
    domain: r.domain,
    upstreamHost: r.upstreamHost,
    upstreamPort: r.upstreamPort,
    protocol: r.protocol,
    layer4Alpn: r.layer4Alpn,
    usesAcme: r.usesAcme,
    // The route's own switch OR its environment's floor. Never AND: an
    // environment turning private must not be able to un-protect a route the
    // operator locked on its own.
    protected: isRouteProtected(r, envProtected),
    routePolicy: r.routePolicy,
    customDirectives: r.customDirectives,
  };
}
