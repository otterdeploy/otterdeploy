import type { volumeSchema } from "@otterdeploy/api/routers/volumes/contract";
import type { z } from "zod";

import { useQuery } from "@tanstack/react-query";
import { useRouteContext } from "@tanstack/react-router";

import { orpc } from "@/shared/server/orpc";

/**
 * Named Docker volumes for the backup-now source picker — a plain query (not a
 * collection): the daemon list is read-only here and only needed while the
 * dialog is open. Orphans are deliberately included: an unclaimed volume is
 * exactly the kind of data someone wants archived before cleaning up.
 */
export type VolumeItem = z.infer<typeof volumeSchema>;

export function useVolumesList(enabled: boolean) {
  // `volumes.list` is install-admin in its entirety, but /backups is an
  // org-level page any member can open — so the request is gated on the
  // installation authority the /_app gate already resolved rather than fired
  // and 403'd. `available` is the caller's cue to drop the Volume source
  // instead of rendering a picker that would always read "No volumes found",
  // which would claim the install has no volumes. Presentation only: the
  // procedure still checks the same flag server-side.
  const isInstallAdmin = useRouteContext({ from: "/_app", select: (c) => c.isInstallAdmin });
  const query = useQuery({
    ...orpc.volumes.list.queryOptions({ input: {} }),
    enabled: enabled && isInstallAdmin,
    staleTime: 15_000,
  });
  return {
    volumes: query.data?.volumes ?? [],
    isLoading: query.isLoading,
    error: query.error,
    /** False when the viewer can't read the daemon inventory at all. */
    available: isInstallAdmin,
  };
}
