/** Namespace prefix for the service-domains collection cache entries — the
 *  single source of truth expose/unexpose + the domains card invalidate to
 *  refetch a service's published hosts immediately. See [[RESOURCE_COLLECTION_KEY]]
 *  for why this is a distinct namespace rather than the raw orpc key. */
export const SERVICE_DOMAINS_COLLECTION_KEY = ["service-domains"] as const;
