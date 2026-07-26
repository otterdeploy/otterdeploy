import type { OrganizationId, ServerId, SshKeyId } from "@otterdeploy/shared/id";
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
  return row;
}

/**
 * Pin (first contact) or confirm/rotate (subsequent, operator-authorized) the
 * SSH host-key fingerprint on record for a server (od-5j8.19). Every write
 * here is a security-relevant event — callers log it (provision-runner.ts on
 * first pin, handlers.ts's confirmHostFingerprint on confirm/rotate).
 */
export async function patchServerHostFingerprint(input: {
  serverId: ServerId;
  organizationId: OrgId;
  hostFingerprint: string;
  hostFingerprintAlgo?: string;
  hostFingerprintVerified: boolean;
}): Promise<ServerRecord | undefined> {
  const [row] = await db
    .update(server)
    .set({
      hostFingerprint: input.hostFingerprint,
      hostFingerprintAlgo: input.hostFingerprintAlgo ?? "sha256",
      hostFingerprintVerified: input.hostFingerprintVerified,
      hostFingerprintPinnedAt: new Date(),
    })
    .where(and(eq(server.id, input.serverId), eq(server.organizationId, input.organizationId)))
    .returning();
  return row;
}

/** od-5j8.19 — mark the currently-pinned fingerprint as operator-confirmed.
 *  Does not change the value; only flips hostFingerprintVerified. */
export async function confirmServerHostFingerprint(input: {
  serverId: ServerId;
  organizationId: OrgId;
}): Promise<ServerRecord | undefined> {
  const [row] = await db
    .update(server)
    .set({ hostFingerprintVerified: true })
    .where(and(eq(server.id, input.serverId), eq(server.organizationId, input.organizationId)))
    .returning();
  return row;
}

/** od-5j8.19 — overwrite the pinned fingerprint with an operator-confirmed
 *  new value (a deliberate rotation, e.g. after rebuilding the host). Always
 *  lands as verified: reaching this call required the typed confirmation
 *  phrase in handlers.ts, i.e. the operator has already asserted they
 *  checked the new key out-of-band. */
export async function rotateServerHostFingerprint(input: {
  serverId: ServerId;
  organizationId: OrgId;
  hostFingerprint: string;
}): Promise<ServerRecord | undefined> {
  return patchServerHostFingerprint({
    serverId: input.serverId,
    organizationId: input.organizationId,
    hostFingerprint: input.hostFingerprint,
    hostFingerprintVerified: true,
  });
}

/**
 * Record the host-firewall + native-bouncer provisioning outcome (od-5j8.11)
 * — written by provision-runner.ts on join and by the reapplyFirewall
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
