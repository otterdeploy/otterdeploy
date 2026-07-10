/**
 * Org database catalog read. One endpoint returns every database resource
 * across the org's projects with runtime status, endpoints, last-backup
 * freshness, and best-effort live stats (each field nullable — see the
 * contract). Polled at 30s so the status pills and connection counts stay
 * honest without hammering the runtime probes.
 */
import type { orgCatalogItemSchema } from "@otterdeploy/api/routers/database/contract-catalog";
import type { z } from "zod";

import { useQuery } from "@tanstack/react-query";

import { orpc } from "@/shared/server/orpc";

export type CatalogDatabase = z.infer<typeof orgCatalogItemSchema>;

export function useDatabaseCatalog() {
  return useQuery({
    ...orpc.database.listOrgCatalog.queryOptions({ input: {} }),
    // The server probes each database with a ~3s cap, so a refetch is cheap
    // and bounded; 30s keeps stats current, focus refetch keeps returns fresh.
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });
}
