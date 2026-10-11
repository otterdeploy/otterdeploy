/** Explicit shared-DB access for previews. A preview joins its own bridge;
 * only referenced, unbranched databases join it, never the whole base network. */
import type { PreviewId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { preview, project, resource } from "@otterdeploy/db/schema/project";
import { Docker } from "@otterdeploy/docker";
import { and, eq } from "drizzle-orm";

import { findResourceContainerId } from "../backups/exec";
import { referencedBaseDatabases } from "../git/preview-db";
import { resolveRuntimeScope } from "../lib/environment/runtime-scope";
import { networkScopeSuffix, runtimeServiceName } from "../lib/environment/scoping";
import { buildContainerName } from "../routers/project/view-helpers";
import { ensureBridgeNetwork } from "./docker-driver-helpers";

export async function ensurePreviewDatabaseAccess(previewId: PreviewId): Promise<void> {
  // oxlint-disable-next-line node/no-process-env -- runtime selection boundary
  if (process.env.DEPLOY_RUNTIME === "swarm") return;
  const [record] = await db
    .select({ row: preview, parent: project })
    .from(preview)
    .innerJoin(project, eq(project.id, preview.projectId))
    .where(eq(preview.id, previewId))
    .limit(1);
  if (!record) throw new Error(`Preview ${previewId} no longer exists`);
  const { row, parent } = record;
  const bases = await referencedBaseDatabases({
    projectId: row.projectId,
    gitRepoId: row.gitRepoId,
  });
  const branches = await db
    .select({ name: resource.name })
    .from(resource)
    .where(and(eq(resource.projectId, row.projectId), eq(resource.previewId, row.id)));
  const branchedNames = new Set(branches.map((b) => b.name));
  const docker = Docker.fromEnv();
  try {
    const network = await ensureBridgeNetwork(docker, parent.slug, networkScopeSuffix(row));
    for (const base of bases) {
      // Existing NULL rows belong to main. Never grant another environment's DB.
      const baseEnv = base.resource.environmentId ?? parent.environmentId;
      if (baseEnv !== parent.environmentId) continue;
      const name = runtimeServiceName(
        buildContainerName({
          engine: base.database.engine,
          projectSlug: parent.slug,
          resourceName: base.resource.name,
          stored: base.database.serviceName,
        }),
        await resolveRuntimeScope(base.resource),
      );
      const containerId = await findResourceContainerId(docker, base.resource.id);
      if (!containerId) continue;
      await setPreviewDatabaseAccess(
        docker,
        containerId,
        network,
        branchedNames.has(base.resource.name) ? null : [name, base.database.internalHostname],
      );
    }
  } finally {
    docker.destroy();
  }
}

export async function setPreviewDatabaseAccess(
  docker: Docker,
  containerId: string,
  network: string,
  aliases: string[] | null,
): Promise<void> {
  const inspected = await docker.containers.inspect(containerId);
  if (inspected.isErr()) throw inspected.error;
  const attached = inspected.value.NetworkSettings?.Networks?.[network];
  const net = docker.networks.getNetwork(network);
  if (!aliases && attached) {
    const off = await net.disconnect({ Container: containerId });
    if (off.isErr()) throw off.error;
  } else if (aliases && !attached) {
    const on = await net.connect({ Container: containerId, EndpointConfig: { Aliases: aliases } });
    if (on.isErr()) throw on.error;
  }
}
