/**
 * Teardown for a database that lives INSIDE a shared server.
 *
 * Split from resource-delete.ts because it is the inverse of a different
 * create: there is no container to stop and no volume to reclaim, only a
 * database and a role to drop on someone else's engine. The manifest strip,
 * the route cleanup and the row delete are identical, which is why the caller
 * simply delegates and returns.
 */
import type { ResourceId } from "@otterdeploy/shared/id";
import type { RequestLogger } from "evlog";

import { Result } from "better-result";

import type { ResourceRef } from "../scopes";

import { deleteProxyRoutesByResource } from "../../caddy/queries";
import { dropTenant, getHostRow } from "../../database-hosting";
import { PostgresResourceNotFoundError } from "./errors";
import { removeDatabaseFromManifest } from "./manifest";
import { deleteResourceById } from "./queries";

/**
 * Delete a database that lives on a shared server: strip it from the manifest,
 * drop its database + role on the host, then remove the row.
 *
 * The drop is best-effort in exactly one direction: the ROW goes either way,
 * because the row is what the platform reasons about, and a row kept alive by
 * a failed drop would be a database the operator cannot delete and cannot use.
 * A drop that failed leaves bytes on the host — surfaced as an orphan record so
 * the sweep retries it rather than losing it in silence.
 */
export async function deleteHostedDatabase(
  args: {
    hostResourceId: ResourceId;
    record: { resource: { name: string }; database: { databaseName: string; username: string } };
    input: ResourceRef;
  },
  log: RequestLogger,
): Promise<Result<{ ok: true }, PostgresResourceNotFoundError>> {
  const { input, record } = args;
  await removeDatabaseFromManifest(
    { projectId: input.projectId, organizationId: input.organizationId },
    record.resource.name,
  );
  await deleteProxyRoutesByResource(input.resourceId);

  const host = await getHostRow({
    organizationId: input.organizationId,
    resourceId: args.hostResourceId,
  });
  let dropped = false;
  if (host) {
    const result = await Result.tryPromise({
      try: () =>
        dropTenant(
          {
            host,
            tenant: {
              databaseName: record.database.databaseName,
              username: record.database.username,
              // The drop plan never authenticates as the tenant, so its
              // password is irrelevant here.
              password: "",
            },
          },
          log,
        ),
      catch: (e: unknown) => e,
    });
    dropped = result.isOk();
    if (result.isErr()) {
      // Nothing else will ever notice this: the row is about to go, so the
      // orphan record is the only thing that remembers a database with real
      // bytes is still sitting on that server. The GC retries the same drop.
      const { recordOrphanedResource } = await import("../../system-health/orphan-gc");
      await recordOrphanedResource({
        organizationId: input.organizationId,
        resourceType: "hosted_database",
        ref: record.database.databaseName,
        projectId: input.projectId,
        payload: { hostResourceId: host.resourceId, username: record.database.username },
        label:
          `hosted database drop failed on server ${host.name}: ` +
          `${result.error instanceof Error ? result.error.message : String(result.error)}`,
      });
    }
  }

  await deleteResourceById(input.resourceId);
  log.set({
    teardown: {
      proxyRoutesRemoved: true,
      hostedDropped: dropped,
      dbDeleted: true,
    },
  });
  return Result.ok({ ok: true });
}
