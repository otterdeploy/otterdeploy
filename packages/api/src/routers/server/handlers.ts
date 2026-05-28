/**
 * Server (swarm node) lifecycle. Per-org scoped.
 *
 * Org scoping is enforced via the `organization_id` column directly — unlike
 * envs, servers don't transitively belong to a project. List / get / delete
 * all filter on `(server.id, server.organizationId)` to prevent cross-tenant
 * reads.
 */

import type { OrganizationId, ServerId } from "@otterdeploy/shared/id";
import { panic, Result } from "better-result";

import { isUniqueViolation } from "../project/views";

import { ServerConflictError, ServerNotFoundError } from "./errors";
import {
  bootstrapLocalhostIfMissing,
  createServerRecord,
  deleteServerRecord,
  getServerInOrg,
  listServersByOrg,
  type ServerRecord,
} from "./queries";

type OrgId = OrganizationId;
interface OrgRef {
  organizationId: OrgId;
}

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
