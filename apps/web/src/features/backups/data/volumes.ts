import type { volumeSchema } from "@otterdeploy/api/routers/volumes/contract";
import type { z } from "zod";

import { useQuery } from "@tanstack/react-query";

import { orpc } from "@/shared/server/orpc";

/**
 * Named Docker volumes for the backup-now source picker — a plain query (not a
 * collection): the daemon list is read-only here and only needed while the
 * dialog is open. Orphans are deliberately included: an unclaimed volume is
 * exactly the kind of data someone wants archived before cleaning up.
 */
export type VolumeItem = z.infer<typeof volumeSchema>;

export function useVolumesList(enabled: boolean) {
  const query = useQuery({
    ...orpc.volumes.list.queryOptions({ input: {} }),
    enabled,
    staleTime: 15_000,
  });
  return {
    volumes: query.data?.volumes ?? [],
    isLoading: query.isLoading,
    error: query.error,
  };
}
