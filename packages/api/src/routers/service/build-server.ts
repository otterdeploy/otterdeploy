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

import type { OrganizationId, ServerId } from "@otterdeploy/shared/id";
import type { RequestLogger } from "evlog";

import { db } from "@otterdeploy/db";
import { serviceResource } from "@otterdeploy/db/schema/project";
import { server } from "@otterdeploy/db/schema/server";
import { Result } from "better-result";
import { and, eq } from "drizzle-orm";

import type { ProjectNotFoundError } from "../project/errors";

import { buildTargetBlocker } from "../../lib/build-target";
import { resolvePlacementSeed } from "../../lib/placement-seed";
import { loadResource } from "./context";
import { BuildServerInvalidError, ServiceNotFoundError } from "./errors";
import { getService } from "./handlers";
import { type ResourceRef } from "./inputs";
import { type ServiceView } from "./views";

const UNKNOWN_BUILD_SERVER = "That server no longer exists.";

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

  // The server must be one of the caller's own organization: a build server
  // runs this service's build, so another organization's would run it on
  // someone else's machine. An id that is not a server, is another
  // organization's, or does not exist all read as "no longer exists".
  const resolved = await resolvePlacementSeed({
    serverId: input.serverId,
    organizationId: input.organizationId,
  });
  if (resolved.isErr()) {
    return Result.err(new BuildServerInvalidError({ message: UNKNOWN_BUILD_SERVER }));
  }
  const serverId = resolved.value;

  if (serverId !== null) {
    const invalid = await validateBuildServer(
      serverId,
      input.organizationId,
      record.service.imageRepository,
    );
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
  organizationId: OrganizationId,
  imageRepository: string | null,
): Promise<string | null> {
  const [row] = await db
    .select({ id: server.id, name: server.name, isBuild: server.buildServer })
    .from(server)
    .where(and(eq(server.id, serverId), eq(server.organizationId, organizationId)))
    .limit(1);
  if (!row) return UNKNOWN_BUILD_SERVER;
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
