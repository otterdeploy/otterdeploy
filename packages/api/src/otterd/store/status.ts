/**
 * A service's live status for the deploy layer, read from the scheduler's
 * state (never from Docker): which grants of the target revision run, which
 * are starting, which failed. This is what `runtime().inspect` answers when
 * otterd owns the resource.
 */
import { db } from "@otterdeploy/db";
import { otterdGrant, otterdNode, otterdService } from "@otterdeploy/db/schema/otterd";
import { resource } from "@otterdeploy/db/schema/project";
import { server } from "@otterdeploy/db/schema/server";
import { idSchema } from "@otterdeploy/shared/id";
import { Result } from "better-result";
import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";

import { type StoreFailure, toStoreFailure } from "./errors";

/** Label the installer gives the first node: the host the platform runs on. */
const PRIMARY_LABEL = "otterdeploy.primary";
/** The bootstrap server row's address (see bootstrapLocalhostIfMissing). */
const LOCALHOST = "127.0.0.1";

export interface ServiceStatus {
  resourceId: string | null;
  revision: number | null;
  status: "running" | "starting" | "stopped" | "missing" | "error";
  /** Grants of the target revision running. */
  running: number;
  desiredPaused: boolean;
  /** Why the target revision's newest attempt could not run, when the node said. */
  failure?: { code: string; message: string } | null;
}

/** "image-pull-failed: …" as a sentence the deploy log can show. */
export const failureText = (f: { code: string; message: string }) =>
  `${f.code.replaceAll("-", " ")}: ${f.message}`;

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
                inArray(
                  otterdGrant.resourceId,
                  services.map((s) => s.resourceId),
                ),
              )
              .orderBy(desc(otterdGrant.createdAt));
      for (const s of services) {
        if (!s.serviceName) continue;
        const ofService = grants.filter((g) => g.resourceId === s.resourceId);
        const mine = ofService.filter((g) => !g.orphan && g.state !== "released");
        // The newest reason the target revision could not run, live or already retired.
        const failure =
          ofService.find((g) => g.specRevision === s.revision && g.failure)?.failure ?? null;
        const current = mine.filter((g) => g.specRevision === s.revision);
        // Serving now: a paused (frozen) process holds the slot but serves nothing.
        const running = current.filter((g) => g.runningSince !== null && !g.failed).length;
        const status: ServiceStatus["status"] =
          current.some((g) => g.failed) || (running === 0 && failure !== null)
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
          failure,
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

export type Pin = { pinned: false } | { pinned: true; nodeId: string | null; serverId: string };

/**
 * Where a resource must run: its `placement_server_id` resolved to the
 * enrolled otterd node of that server. A pin to a server with no enrolled
 * node resolves to `nodeId: null`, which the caller refuses rather than
 * running the resource anywhere else.
 */
/** The newest live node the installer enrolled first: the host the platform and its builder run on. */
async function primaryNode(): Promise<string | null> {
  const [primary] = await db
    .select({ nodeId: otterdNode.nodeId })
    .from(otterdNode)
    .where(
      and(sql`${otterdNode.labels} ->> ${PRIMARY_LABEL} = 'true'`, ne(otterdNode.admin, "retired")),
    )
    .orderBy(desc(otterdNode.enrolledAt))
    .limit(1);
  return primary?.nodeId ?? null;
}

/** The node the builder `--load`s images into, which alone holds a registry-less image. */
export const buildHostNode = (): Promise<Result<string | null, StoreFailure>> =>
  Result.tryPromise({ try: primaryNode, catch: toStoreFailure });

export function pinOf(resourceId: string): Promise<Result<Pin, StoreFailure>> {
  return Result.tryPromise({
    catch: toStoreFailure,
    try: async (): Promise<Pin> => {
      const id = idSchema.resource.safeParse(resourceId);
      if (!id.success) return { pinned: false };
      const [row] = await db
        .select({ serverId: resource.placementServerId })
        .from(resource)
        .where(eq(resource.id, id.data));
      if (!row?.serverId) return { pinned: false };
      const live = ne(otterdNode.admin, "retired");
      const [linked] = await db
        .select({ nodeId: otterdNode.nodeId })
        .from(otterdNode)
        .where(and(eq(otterdNode.serverId, row.serverId), live));
      if (linked) return { pinned: true, nodeId: linked.nodeId, serverId: row.serverId };
      // The bootstrap `localhost` row (one per organization, created after
      // the install) is the host the installer enrolled first: that node
      // carries the PRIMARY_LABEL instead of a server id.
      const [srv] = await db
        .select({ host: server.host })
        .from(server)
        .where(eq(server.id, row.serverId));
      const primary = srv?.host === LOCALHOST ? await primaryNode() : null;
      return { pinned: true, nodeId: primary, serverId: row.serverId };
    },
  });
}
