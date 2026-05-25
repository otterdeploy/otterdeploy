import { and, asc, eq } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";

import { db } from "@otterstack/db";
import { server } from "@otterstack/db/schema/server";
import { type Id, ID_PREFIX } from "@otterstack/shared/id";

import type { ServerId } from "./errors";

type OrgId = Id<typeof ID_PREFIX.organization>;

export type ServerRecord = InferSelectModel<typeof server>;

export async function listServersByOrg(organizationId: OrgId): Promise<ServerRecord[]> {
  return db
    .select()
    .from(server)
    .where(eq(server.organizationId, organizationId))
    .orderBy(asc(server.createdAt));
}

export async function getServerInOrg(input: {
  serverId: ServerId;
  organizationId: OrgId;
}): Promise<ServerRecord | undefined> {
  const [row] = await db
    .select()
    .from(server)
    .where(
      and(
        eq(server.id, input.serverId),
        eq(server.organizationId, input.organizationId),
      ),
    )
    .limit(1);
  return row;
}

export async function createServerRecord(input: {
  id?: ServerId;
  organizationId: OrgId;
  name: string;
  host: string;
  region: string;
  role?: "manager" | "worker";
  cpuTotal: number;
  memTotalGb: number;
  diskTotalGb?: number;
  diskUnit?: string;
  daemonVersion?: string;
  labels?: string[];
}): Promise<ServerRecord | undefined> {
  const [row] = await db.insert(server).values(input).returning();
  return row;
}

export async function deleteServerRecord(input: {
  serverId: ServerId;
  organizationId: OrgId;
}): Promise<{ id: ServerId } | undefined> {
  const [deleted] = await db
    .delete(server)
    .where(
      and(
        eq(server.id, input.serverId),
        eq(server.organizationId, input.organizationId),
      ),
    )
    .returning({ id: server.id });
  return deleted;
}
