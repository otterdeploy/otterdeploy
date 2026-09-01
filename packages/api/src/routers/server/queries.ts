import type { OrganizationId, ServerId, SshKeyId } from "@otterdeploy/shared/id";
import type { InferSelectModel } from "drizzle-orm";

import { db } from "@otterdeploy/db";
import { project, resource, serviceResource } from "@otterdeploy/db/schema/project";
import { server } from "@otterdeploy/db/schema/server";
import { and, asc, eq, inArray } from "drizzle-orm";
import os from "node:os";

import { hostHostname } from "../../system-health/host-identity";
import { publishOrgEvent } from "../project/project-event-bus";
type OrgId = OrganizationId;

export type ServerRecord = InferSelectModel<typeof server>;

export async function listServersByOrg(organizationId: OrgId): Promise<ServerRecord[]> {
  return db
    .select()
    .from(server)
    .where(eq(server.organizationId, organizationId))
    .orderBy(asc(server.createdAt));
}

/**
 * Every provisioned server in the install, across organizations.
 *
 * Edge reconciliation is install-wide because the config a node needs is
 * defined by what it must STOP serving as much as what it must start. A node
 * whose only service just moved away has no routes and no org with routes.
 * Scoping the sweep to orgs that currently have routes would skip exactly the
 * node holding the stale one, and it would keep answering for a domain it no
 * longer runs.
 */
export async function listAllServers(): Promise<ServerRecord[]> {
  return db.select().from(server).orderBy(asc(server.name));
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
  if (row) publishOrgEvent(input.organizationId, "servers");
  return row;
}

/**
 * Insert a server row in the `pending` provisioning state, carrying the SSH
 * connection details the runner needs. Capacity stays 0 until the health agent
 * self-registers; `status` is `down` until the node actually joins.
 */
export async function insertProvisioningServer(input: {
  id?: ServerId;
  organizationId: OrgId;
  name: string;
  host: string;
  role: "manager" | "worker";
  sshKeyId?: SshKeyId | null;
  sshUser: string;
  sshPort: number;
  meshProvider?: "none" | "tailscale" | "netbird";
  buildServer?: boolean;
}): Promise<ServerRecord | undefined> {
  const [row] = await db
    .insert(server)
    .values({
      ...input,
      cpuTotal: 0,
      memTotalGb: 0,
      status: "down",
      provisionStatus: "pending",
    })
    .returning();
  if (row) publishOrgEvent(input.organizationId, "servers");
  return row;
}

/** Patch the provisioning lifecycle fields as the runner advances. Org-scoped. */
export async function patchServerProvision(input: {
  serverId: ServerId;
  organizationId: OrgId;
  provisionStatus?: "pending" | "provisioning" | "joining" | "ready" | "failed";
  provisionError?: string | null;
  status?: "ready" | "draining" | "down";
  hostname?: string | null;
  daemonVersion?: string | null;
  meshAddress?: string | null;
}): Promise<ServerRecord | undefined> {
  const { serverId, organizationId, ...set } = input;
  const [row] = await db
    .update(server)
    .set(set)
    .where(and(eq(server.id, serverId), eq(server.organizationId, organizationId)))
    .returning();
  if (row) publishOrgEvent(organizationId, "servers");
  return row;
}

/**
 * Record the host-firewall + native-bouncer provisioning outcome (od-5j8.11):
 * written by provision-runner.ts on join and by the reapplyFirewall
 * remediation path. Separate from patchServerProvision so a firewall-only
 * remediation run (which doesn't touch provisionStatus) can't accidentally
 * clobber the swarm-join lifecycle fields.
 */
export async function patchServerFirewall(input: {
  serverId: ServerId;
  organizationId: OrgId;
  firewallStatus: "unknown" | "applied" | "failed" | "unsupported";
  firewallError?: string | null;
  firewallBouncerActive?: boolean;
}): Promise<ServerRecord | undefined> {
  const { serverId, organizationId, ...set } = input;
  const [row] = await db
    .update(server)
    .set({
      ...set,
      firewallAppliedAt: input.firewallStatus === "applied" ? new Date() : null,
    })
    .where(and(eq(server.id, serverId), eq(server.organizationId, organizationId)))
    .returning();
  if (row) publishOrgEvent(organizationId, "servers");
  return row;
}

/** Persist a swarm-confirmed promote/demote back onto the server row. */
export async function updateServerRoleRecord(input: {
  serverId: ServerId;
  organizationId: OrgId;
  role: "manager" | "worker";
}): Promise<ServerRecord | undefined> {
  const [row] = await db
    .update(server)
    .set({ role: input.role })
    .where(and(eq(server.id, input.serverId), eq(server.organizationId, input.organizationId)))
    .returning();
  if (row) publishOrgEvent(input.organizationId, "servers");
  return row;
}

/** Persist a swarm-confirmed availability change back onto the server row. */
export async function updateServerAvailabilityRecord(input: {
  serverId: ServerId;
  organizationId: OrgId;
  availability: "active" | "drain" | "pause";
}): Promise<ServerRecord | undefined> {
  const [row] = await db
    .update(server)
    .set({ availability: input.availability })
    .where(and(eq(server.id, input.serverId), eq(server.organizationId, input.organizationId)))
    .returning();
  if (row) publishOrgEvent(input.organizationId, "servers");
  return row;
}

export async function deleteServerRecord(input: {
  serverId: ServerId;
  organizationId: OrgId;
}): Promise<{ id: ServerId; unpinnedResources: number } | undefined> {
  // placement_server_id carries no FK (resource is org-scoped through project,
  // server is org-scoped directly. There is no single parent to cascade from),
  // so the pin has to be released here. Left dangling, every affected resource
  // would resolve its placement to a server that no longer exists: a stateless
  // one would deploy unpinned with a confusing warning forever, and a database
  // would refuse to deploy at all. Clearing it means "schedulable again", which
  // is the honest state once the machine is gone.
  return db.transaction(async (tx) => {
    const orgProjects = tx
      .select({ id: project.id })
      .from(project)
      .where(eq(project.organizationId, input.organizationId));

    const unpinned = await tx
      .update(resource)
      .set({ placementServerId: null })
      .where(
        and(
          eq(resource.placementServerId, input.serverId),
          inArray(resource.projectId, orgProjects),
        ),
      )
      .returning({ id: resource.id });

    // Same story for the BUILD assignment (build_server_id, also FK-less): a
    // project or service still pointing at the removed machine would resolve
    // to a lane whose builder is gone, and its deploys would sit `pending`
    // with no consumer. Clearing it means "build wherever you run again",
    // which is the only state that still works once the box is gone.
    await tx
      .update(project)
      .set({ buildServerId: null })
      .where(
        and(
          eq(project.buildServerId, input.serverId),
          eq(project.organizationId, input.organizationId),
        ),
      );
    await tx
      .update(serviceResource)
      .set({ buildServerId: null })
      .where(
        and(
          eq(serviceResource.buildServerId, input.serverId),
          inArray(
            serviceResource.resourceId,
            tx
              .select({ id: resource.id })
              .from(resource)
              .where(inArray(resource.projectId, orgProjects)),
          ),
        ),
      );

    const [deleted] = await tx
      .delete(server)
      .where(and(eq(server.id, input.serverId), eq(server.organizationId, input.organizationId)))
      .returning({ id: server.id });

    // Server wasn't ours. Roll the unpin back rather than quietly editing
    // another org's resources.
    if (!deleted) {
      tx.rollback();
      return undefined;
    }
    publishOrgEvent(input.organizationId, "servers");
    return { id: deleted.id, unpinnedResources: unpinned.length };
  });
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
  const hostname = hostHostname() || null;

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
