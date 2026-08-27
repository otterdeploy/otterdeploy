/**
 * Warm everything the Edge page's tabs read, on hover of the nav link.
 *
 * Split from the route file (which is at its line cap) and worth its own
 * module anyway: this is the one place that knows which of the page's reads
 * are install-admin-only, and getting that wrong means every member who so
 * much as hovers "Edge" triggers a 403.
 *
 * All best-effort and non-blocking. A prefetch that fails or is denied simply
 * leaves the tab to fetch on mount, exactly as it did before.
 */
import type { QueryClient } from "@tanstack/react-query";

import { prefetchFirewall } from "@/features/firewall/data";
import { orpc } from "@/shared/server/orpc";

export function prefetchEdge(queryClient: QueryClient, isInstallAdmin: boolean): void {
  // Install-admin only, and this runs on plain NAVIGATION. An unconditional
  // prefetch is a 403 for every member who hovers the Edge link, whether or
  // not they can ever open the plane. `enabled: false` on the tab's own query
  // would not cover this.
  if (isInstallAdmin) {
    void queryClient.prefetchQuery(orpc.system.caddyfile.queryOptions()).catch(() => undefined);
    // Same gate: the whole firewall router is install-admin.
    prefetchFirewall(queryClient);
  }
  void queryClient.prefetchQuery(orpc.certificates.inventory.queryOptions()).catch(() => undefined);
  void queryClient.prefetchQuery(orpc.certificates.listCustom.queryOptions()).catch(() => undefined);
  void queryClient.prefetchQuery(orpc.certificates.listCas.queryOptions()).catch(() => undefined);
}
