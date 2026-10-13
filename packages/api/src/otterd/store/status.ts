/**
 * A service's live status for the deploy layer, read from the scheduler's
 * state (never from Docker): which grants of the target revision run, which
 * are starting, which failed. This is what `runtime().inspect` answers when
 * otterd owns the resource.
 */
import { db } from "@otterdeploy/db";
import { otterdGrant, otterdService } from "@otterdeploy/db/schema/otterd";
import { resource } from "@otterdeploy/db/schema/project";
import { idSchema } from "@otterdeploy/shared/id";
import { Result } from "better-result";
import { and, eq, inArray, ne } from "drizzle-orm";

import { type StoreFailure, toStoreFailure } from "./errors";

export interface ServiceStatus {
  resourceId: string | null;
  revision: number | null;
  status: "running" | "starting" | "stopped" | "missing" | "error";
  /** Grants of the target revision running. */
  running: number;
  desiredPaused: boolean;
}

export function statusByName(
  serviceNames: readonly string[],
): Promise<Result<Map<string, ServiceStatus>, StoreFailure>> {
  return Result.tryPromise({
    catch: toStoreFailure,
    try: async () => {
      const out = new Map<string, ServiceStatus>();
      for (const n of serviceNames)
        out.set(n, {
          resourceId: null,
          revision: null,
          status: "missing",
          running: 0,
          desiredPaused: false,
        });
      if (serviceNames.length === 0) return out;
      const services = await db
        .select()
        .from(otterdService)
        .where(inArray(otterdService.serviceName, [...serviceNames]));
      const grants =
        services.length === 0
          ? []
          : await db
              .select()
              .from(otterdGrant)
              .where(
                and(
                  inArray(
                    otterdGrant.resourceId,
                    services.map((s) => s.resourceId),
                  ),
                  ne(otterdGrant.state, "released"),
                ),
              );
      for (const s of services) {
        if (!s.serviceName) continue;
        const mine = grants.filter((g) => g.resourceId === s.resourceId && !g.orphan);
        const current = mine.filter((g) => g.specRevision === s.revision);
        const running = current.filter((g) => g.state === "running" && !g.failed).length;
        const status: ServiceStatus["status"] = current.some((g) => g.failed)
          ? "error"
          : running > 0
            ? "running"
            : mine.length > 0
              ? "starting"
              : s.paused
                ? "stopped"
                : "starting";
        out.set(s.serviceName, {
          resourceId: s.resourceId,
          revision: s.revision,
          status,
          running,
          desiredPaused: s.paused,
        });
      }
      return out;
    },
  });
}

/** Claim a resource for otterd. A resource another runtime owns is never taken here. */
export function claimForOtterd(resourceId: string): Promise<Result<boolean, StoreFailure>> {
  return Result.tryPromise({
    catch: toStoreFailure,
    try: async () => {
      const id = idSchema.resource.safeParse(resourceId);
      if (!id.success) return true;
      const [row] = await db
        .select({ owner: resource.runtimeOwner })
        .from(resource)
        .where(eq(resource.id, id.data));
      // A resource without a row (an internal workload) belongs to whoever deploys it.
      if (!row) return true;
      if (row.owner === "otterd") return true;
      // Only the otterd driver calls this, and it runs only on installs that
      // run otterd from the start: no legacy workload exists to hand over.
      await db.update(resource).set({ runtimeOwner: "otterd" }).where(eq(resource.id, id.data));
      return true;
    },
  });
}
