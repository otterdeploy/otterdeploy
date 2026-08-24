/**
 * Assign (or clear) the dedicated build server for one service.
 *
 * Deliberately its own writable surface, the same rule placement follows: two
 * places to set this would drift, and "where does this build" is not the kind
 * of thing that can be half-right.
 *
 * Unlike placement, this does NOT roll the service. The assignment changes
 * where the NEXT build runs, not the running spec, so redeploying here would
 * restart a container for a setting that has no effect on it.
 *
 * The validation is the point. A build server only helps if the image can
 * reach the nodes that run the service, which means a registry: without one
 * the image stays in the build box's docker daemon and every run node fails to
 * pull it. That is knowable when the operator assigns it, so it's refused here
 * rather than discovered after a green build and a stuck deploy.
 */

import type { ServerId } from "@otterdeploy/shared/id";
import type { RequestLogger } from "evlog";

import { db } from "@otterdeploy/db";
import { serviceResource } from "@otterdeploy/db/schema/project";
import { server } from "@otterdeploy/db/schema/server";
import { ID_PREFIX, hasPrefix } from "@otterdeploy/shared/id";
import { Result } from "better-result";
import { eq } from "drizzle-orm";

import type { ProjectNotFoundError } from "../project/errors";

import { buildTargetBlocker } from "../../lib/build-target";
import { loadResource } from "./context";
import { BuildServerInvalidError, ServiceNotFoundError } from "./errors";
import { getService } from "./handlers";
import { type ResourceRef } from "./inputs";
import { type ServiceView } from "./views";

type SetBuildServerError = ProjectNotFoundError | ServiceNotFoundError | BuildServerInvalidError;

export interface SetBuildServerInput extends ResourceRef {
  /** Server to build on, or null to inherit the project's (then the default). */
  serverId: string | null;
}

export async function setServiceBuildServer(
  input: SetBuildServerInput,
  log: RequestLogger,
): Promise<Result<ServiceView, SetBuildServerError>> {
  const ctx = await loadResource(input);
  if (ctx.isErr()) return Result.err(ctx.error);
  const { record } = ctx.value;

  const current = record.service.buildServerId ?? null;
  // Idempotent: saving the form unchanged shouldn't write.
  if (current === input.serverId) return getService(input);

  // Recover the brand with a real check rather than a cast: a non-server id
  // here is caller error, and the same idiom setResourcePlacement uses.
  if (input.serverId !== null && !hasPrefix(input.serverId, ID_PREFIX.server)) {
    return Result.err(
      new BuildServerInvalidError({ message: `${input.serverId} is not a server id` }),
    );
  }
  const serverId = input.serverId;

  if (serverId !== null) {
    const invalid = await validateBuildServer(serverId, record.service.imageRepository);
    if (invalid) return Result.err(new BuildServerInvalidError({ message: invalid }));
  }

  await db
    .update(serviceResource)
    .set({ buildServerId: serverId })
    .where(eq(serviceResource.resourceId, record.service.resourceId));

  log.set({
    serviceBuildServer: {
      resourceId: input.resourceId,
      from: current,
      to: input.serverId,
    },
  });
  return getService(input);
}

/**
 * Why this server can't be this service's builder, or null when it can.
 *
 * Checked at assign time so the operator gets the answer while they're looking
 * at the setting, not on the next push.
 */
async function validateBuildServer(
  serverId: ServerId,
  imageRepository: string | null,
): Promise<string | null> {
  const [row] = await db
    .select({ id: server.id, name: server.name, isBuild: server.buildServer })
    .from(server)
    .where(eq(server.id, serverId))
    .limit(1);
  if (!row) return "That server no longer exists.";
  if (!row.isBuild) {
    return (
      `"${row.name}" isn't marked as a build server, so nothing is set up to build there. ` +
      `Enable "dedicated build server" on the server first.`
    );
  }
  return buildTargetBlocker({
    target: { serverId: row.id, serverName: row.name },
    imageRepository,
  });
}
