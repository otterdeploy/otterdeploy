/**
 * Reads behind Settings → Domains. The DNS check does live lookups (public
 * resolvers, a Cloudflare round trip for the zone), so these are cached for a
 * while and refetched on purpose ("Check DNS", a save, a write) rather than on
 * every focus.
 */

import type { OrganizationId } from "@otterdeploy/shared/id";

import { useQuery } from "@tanstack/react-query";

import { orpc, queryClient } from "@/shared/server/orpc";

const LIVE_DNS = { staleTime: 30_000, refetchOnWindowFocus: false } as const;

export function useBaseDomainDns(organizationId: OrganizationId) {
  return useQuery({
    ...orpc.organization.checkBaseDomainDns.queryOptions({ input: { organizationId } }),
    ...LIVE_DNS,
  });
}

export function useCloudflareZone(organizationId: OrganizationId, enabled: boolean) {
  return useQuery({
    ...orpc.organization.cloudflareZone.queryOptions({ input: { organizationId } }),
    ...LIVE_DNS,
    enabled,
  });
}

export function useBaseDomainHostnames(organizationId: OrganizationId, enabled: boolean) {
  return useQuery({
    ...orpc.organization.baseDomainHostnames.queryOptions({ input: { organizationId } }),
    enabled,
  });
}

/** After anything that changes the domain, its records, or Cloudflare. */
export function invalidateBaseDomain(organizationId: OrganizationId) {
  const input = { input: { organizationId } };
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: orpc.organization.settings.queryKey(input) }),
    queryClient.invalidateQueries({
      queryKey: orpc.organization.checkBaseDomainDns.queryKey(input),
    }),
    queryClient.invalidateQueries({
      queryKey: orpc.organization.baseDomainHostnames.queryKey(input),
    }),
    queryClient.invalidateQueries({ queryKey: orpc.organization.cloudflareZone.queryKey(input) }),
  ]);
}
