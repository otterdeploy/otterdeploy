/**
 * Base URL to put in anything the operator copies OUT of the dashboard — a
 * `otterdeploy login` line, a curl one-liner pasted onto a new host.
 *
 * `window.location.origin` is where *this* browser happens to be, which on a
 * default install is the server's raw IP over plaintext. That address is fine
 * for the tab you already have open and wrong for a command that gets pasted
 * onto another machine and outlives it. Prefer the operator's control-plane
 * domain once it is VERIFIED — unverified means a self-signed certificate, so
 * a curl against it would fail closed rather than fall back.
 *
 * Client-side twin of `resolveCanonicalWebOrigin` on the server; shared so the
 * two copy-paste surfaces can't disagree about their own address again.
 */

import { useQuery } from "@tanstack/react-query";
import { useLoaderData, useRouteContext } from "@tanstack/react-router";

import { orpc } from "@/shared/server/orpc";

export function useControlPlaneBaseUrl(): string {
  const { organization } = useLoaderData({ from: "/_app/$orgSlug" });
  // `organization.controlPlaneDomain` is install-scoped and admin-only, so
  // non-admins simply keep the current origin rather than getting a 403.
  const isInstallAdmin = useRouteContext({ from: "/_app", select: (c) => c.isInstallAdmin });

  const domainQuery = useQuery({
    ...orpc.organization.controlPlaneDomain.queryOptions({
      input: { organizationId: organization.id },
    }),
    enabled: isInstallAdmin,
  });

  const fqdn = domainQuery.data;
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return fqdn?.domain && fqdn.verifiedAt ? `https://${fqdn.domain}` : origin;
}
