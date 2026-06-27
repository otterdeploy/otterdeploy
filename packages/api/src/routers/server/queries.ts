import type { OrganizationId, ServerId } from "@otterdeploy/shared/id";
import type { InferSelectModel } from "drizzle-orm";

import { db } from "@otterdeploy/db";
import { server } from "@otterdeploy/db/schema/server";
import { and, asc, eq } from "drizzle-orm";
import os from "node:os";
type OrgId = OrganizationId;

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
    .where(and(eq(server.id, input.serverId), eq(server.organizationId, input.organizationId)))
    .limit(1);
  return row;
}

export async function createServerRecord(input: {
  id?: ServerId;
  organizationId: OrgId;
  name: string;
  hostname?: string;
  host: string;
  region?: string;
  role?: "manager" | "worker";
  cpuTotal?: number;
  memTotalGb?: number;
  diskTotalGb?: number;
  diskUnit?: string;
  daemonVersion?: string;
  labels?: string[];
}): Promise<ServerRecord | undefined> {
  const [row] = await db
    .insert(server)
    .values({
      ...input,
      cpuTotal: input.cpuTotal ?? 0,
      memTotalGb: input.memTotalGb ?? 0,
    })
    .returning();
  return row;
}

export async function deleteServerRecord(input: {
  serverId: ServerId;
  organizationId: OrgId;
}): Promise<{ id: ServerId } | undefined> {
  const [deleted] = await db
    .delete(server)
    .where(and(eq(server.id, input.serverId), eq(server.organizationId, input.organizationId)))
    .returning({ id: server.id });
  return deleted;
}

/**
 * Ensure the bootstrap localhost row exists for an org. Every workspace's
 * first manager is the host running otterdeploy itself (the same machine
 * the user would `docker swarm init` on); we surface it as a real DB row
 * so the UI never shows a "no servers" empty state and `docker service
 * create` always has a node to schedule against.
 *
 * Idempotent: relies on the (organizationId, host) unique index added in
 * the server schema, so concurrent first-list races resolve to a single
 * row via ON CONFLICT DO NOTHING.
 */
export async function bootstrapLocalhostIfMissing(organizationId: OrgId): Promise<void> {
  const cpuCount = os.cpus().length;
  const memTotalGb = Math.max(1, Math.round(os.totalmem() / 1024 ** 3));
  const hostname = os.hostname() || null;

  // Upsert: insert new orgs, and back-fill the canonical name/hostname pair
  // on existing rows that were created before the schema split (when the OS
  // hostname was stored as `name`).
  await db
    .insert(server)
    .values({
      organizationId,
      name: "localhost",
      hostname,
      host: "127.0.0.1",
      region: "local",
      role: "manager",
      status: "ready",
      availability: "active",
      cpuTotal: cpuCount,
      memTotalGb,
      labels: ["bootstrap"],
    })
    .onConflictDoUpdate({
      target: [server.organizationId, server.host],
      set: { name: "localhost", hostname },
    });
}
