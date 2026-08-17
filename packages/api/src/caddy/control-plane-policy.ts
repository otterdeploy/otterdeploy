import type { RoutePolicy } from "@otterdeploy/shared/route-policy";

import { DEFAULT_ROUTE_POLICY } from "@otterdeploy/shared/route-policy";

/**
 * Secure-by-default policy for the control plane's OWN dashboard/API route
 * (od-5j8.10). Unlike a tenant route's `routePolicy`, which starts fully OFF
 * (DEFAULT_ROUTE_POLICY) until the operator opts in via the Networking
 * panel, this is otterdeploy's own admin surface: HSTS + baseline hardening
 * headers apply unconditionally the moment a control-plane domain is
 * configured and Caddy fronts it, no per-route panel needed, and nothing a
 * tenant ever controls.
 *
 * `maxRequestBodyMb` is left null (unbounded at the edge). The app's own
 * per-route body-limit gate is the enforcement point
 * (packages/api/src/security/body-limit.ts), so this doesn't double-cap
 * uploads (e.g. source tarballs) at a size Caddy can't tell apart from an
 * ordinary API call.
 *
 * Split into its own file (rather than living in ./index.ts, which imports
 * `@otterdeploy/db` at module scope) so it can be imported from a unit test
 * with no database/env side effects.
 */
export const CONTROL_PLANE_ROUTE_POLICY: RoutePolicy = {
  ...DEFAULT_ROUTE_POLICY,
  hsts: "one-year-subdomains",
  contentTypeNosniff: true,
  frameOptions: "deny",
  referrerPolicy: "strict-origin-when-cross-origin",
};
