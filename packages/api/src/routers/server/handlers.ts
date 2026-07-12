/**
 * Server (swarm node) lifecycle. Per-org scoped.
 *
 * Org scoping is enforced via the `organization_id` column directly — unlike
 * envs, servers don't transitively belong to a project. List / get / delete
 * all filter on `(server.id, server.organizationId)` to prevent cross-tenant
 * reads.
 */

import type { ServerId, SshKeyId } from "@otterdeploy/shared/id";

import { panic, Result } from "better-result";

import type { OrgRef } from "../scopes";

import { isUniqueViolation } from "../project/views";
import {
  ProvisionCredentialError,
  ProvisionMissingCredentialError,
  ProvisionNotFailedError,
  ServerConflictError,
  ServerNotFoundError,
} from "./errors";
import { enqueueProvision } from "./provision-runner";
import {
  bootstrapLocalhostIfMissing,
  createServerRecord,
  deleteServerRecord,
  getServerInOrg,
  insertProvisioningServer,
  listServersByOrg,
  patchServerProvision,
  type ServerRecord,
} from "./queries";

export async function listServers(input: OrgRef): Promise<ServerRecord[]> {
  // Guarantee at least the bootstrap localhost row exists for every org.
  // No-op once the row is present (ON CONFLICT DO NOTHING).
  await bootstrapLocalhostIfMissing(input.organizationId);
  return listServersByOrg(input.organizationId);
}

export async function getServer(
  input: { id: ServerId } & OrgRef,
): Promise<Result<ServerRecord, ServerNotFoundError>> {
  const record = await getServerInOrg({
    serverId: input.id,
    organizationId: input.organizationId,
  });
  if (!record) {
    return Result.err(new ServerNotFoundError({ serverId: input.id }));
  }
  return Result.ok(record);
}

export async function createServer(
  input: {
    id?: ServerId;
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
  } & OrgRef,
): Promise<Result<ServerRecord, ServerConflictError>> {
  const insert = await Result.tryPromise({
    try: () =>
      createServerRecord({
        ...input,
        name: input.name.trim(),
        host: input.host.trim(),
      }),
    catch: (cause) =>
      isUniqueViolation(cause)
        ? new ServerConflictError({ host: input.host })
        : panic("server.createServer: unexpected DB error", cause),
  });
  if (Result.isError(insert)) return Result.err(insert.error);
  if (!insert.value) {
    return Result.err(new ServerConflictError({ host: input.host }));
  }
  return Result.ok(insert.value);
}

export async function provisionServer(
  input: {
    id?: ServerId;
    name: string;
    host: string;
    sshUser: string;
    sshPort: number;
    role: "manager" | "worker";
    sshKeyId?: SshKeyId;
    password?: string;
    buildServer?: boolean;
    meshProvider?: "none" | "tailscale" | "netbird";
    meshManagementUrl?: string;
    meshAuthKey?: string;
    cloudflareToken?: string;
  } & OrgRef,
): Promise<Result<ServerRecord, ServerConflictError | ProvisionCredentialError>> {
  // Exactly one SSH credential. Neither → nothing to auth with; both → ambiguous.
  const hasKey = input.sshKeyId != null;
  const hasPassword = input.password != null && input.password.length > 0;
  if (hasKey === hasPassword) {
    return Result.err(new ProvisionCredentialError());
  }
  const meshProvider = input.meshProvider ?? "none";

  const insert = await Result.tryPromise({
    try: () =>
      insertProvisioningServer({
        id: input.id,
        organizationId: input.organizationId,
        name: input.name.trim(),
        host: input.host.trim(),
        role: input.role,
        sshKeyId: input.sshKeyId ?? null,
        sshUser: input.sshUser,
        sshPort: input.sshPort,
        meshProvider,
        buildServer: input.buildServer ?? false,
      }),
    catch: (cause) =>
      isUniqueViolation(cause)
        ? new ServerConflictError({ host: input.host })
        : panic("server.provisionServer: unexpected DB error", cause),
  });
  if (Result.isError(insert)) return Result.err(insert.error);
  if (!insert.value) return Result.err(new ServerConflictError({ host: input.host }));

  await enqueueProvision({
    serverId: insert.value.id,
    organizationId: input.organizationId,
    host: insert.value.host,
    sshUser: input.sshUser,
    sshPort: input.sshPort,
    role: input.role,
    sshKeyId: input.sshKeyId ?? null,
    buildServer: input.buildServer ?? false,
    meshProvider,
    meshManagementUrl: input.meshManagementUrl,
    password: input.password,
    meshAuthKey: input.meshAuthKey,
    cloudflareToken: input.cloudflareToken,
  });
  return Result.ok(insert.value);
}

export async function retryProvision(
  input: { id: ServerId } & OrgRef,
): Promise<
  Result<
    ServerRecord,
    ServerNotFoundError | ProvisionNotFailedError | ProvisionMissingCredentialError
  >
> {
  const existing = await getServerInOrg({
    serverId: input.id,
    organizationId: input.organizationId,
  });
  if (!existing) return Result.err(new ServerNotFoundError({ serverId: input.id }));
  if (existing.provisionStatus !== "failed") {
    return Result.err(
      new ProvisionNotFailedError({ serverId: input.id, status: existing.provisionStatus }),
    );
  }
  // A one-time-password run — or a mesh join — stored no reusable secret, so
  // there's nothing left to reconnect/rejoin with. Re-add the server instead.
  if (!existing.sshKeyId || existing.meshProvider !== "none") {
    return Result.err(new ProvisionMissingCredentialError({ serverId: input.id }));
  }

  const patched = await patchServerProvision({
    serverId: input.id,
    organizationId: input.organizationId,
    provisionStatus: "pending",
    provisionError: null,
  });
  const row = patched ?? existing;

  await enqueueProvision({
    serverId: row.id,
    organizationId: input.organizationId,
    host: row.host,
    sshUser: row.sshUser,
    sshPort: row.sshPort,
    role: row.role,
    sshKeyId: existing.sshKeyId,
    buildServer: row.buildServer,
    meshProvider: "none",
  });
  return Result.ok(row);
}

export async function deleteServer(
  input: { id: ServerId } & OrgRef,
): Promise<Result<{ ok: true }, ServerNotFoundError>> {
  const deleted = await deleteServerRecord({
    serverId: input.id,
    organizationId: input.organizationId,
  });
  if (!deleted) {
    return Result.err(new ServerNotFoundError({ serverId: input.id }));
  }
  return Result.ok({ ok: true });
}
