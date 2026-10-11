/** Existing installs predate scoped bridges. Reconcile actual containers on boot,
 * using stored resource/deployment ownership rather than guessing from aliases. */
import { db } from "@otterdeploy/db";
import {
  deployment,
  environment,
  preview,
  project,
  resource,
  serviceResource,
} from "@otterdeploy/db/schema/project";
import { Docker } from "@otterdeploy/docker";
import { eq } from "drizzle-orm";

import { networkScopeSuffix, type PreviewScope } from "../lib/environment/scoping";
import { ensureBridgeNetwork } from "./docker-driver-helpers";
import { moveToScopedNetwork } from "./docker-network-migration";
import { ensurePreviewDatabaseAccess } from "./preview-network-access";

async function networkTargets() {
  const [rows, previews, deployments] = await Promise.all([
    db
      .select({
        resourceId: resource.id,
        serviceName: serviceResource.serviceName,
        gitRepoId: serviceResource.gitRepoId,
        previewId: resource.previewId,
        projectId: project.id,
        projectSlug: project.slug,
        environmentId: resource.environmentId,
        mainId: project.environmentId,
        environmentSlug: environment.slug,
      })
      .from(resource)
      .innerJoin(project, eq(project.id, resource.projectId))
      .leftJoin(environment, eq(environment.id, resource.environmentId))
      .leftJoin(serviceResource, eq(serviceResource.resourceId, resource.id)),
    db
      .select({
        id: preview.id,
        projectId: preview.projectId,
        gitRepoId: preview.gitRepoId,
        state: preview.state,
        slug: preview.slug,
        prNumber: preview.prNumber,
      })
      .from(preview),
    db.select({ id: deployment.id, previewId: deployment.previewId }).from(deployment),
  ]);
  const byResource = new Map(rows.map((r) => [String(r.resourceId), r]));
  const byDeployment = new Map(deployments.map((d) => [String(d.id), d.previewId]));
  function resolve(container: { Id: string; Names: string[]; Labels: Record<string, string> }) {
    const row = byResource.get(container.Labels["otterdeploy.resource.id"] ?? "");
    if (!row) return null;
    const previewId =
      row.previewId ?? byDeployment.get(container.Labels["otterdeploy.deployment.id"] ?? "");
    const scope = previewId
      ? previews.find((p) => p.id === previewId)
      : previews.find(
          (p) =>
            p.projectId === row.projectId &&
            p.gitRepoId === row.gitRepoId &&
            container.Names.some((name) =>
              ["", "--next", "--prev"].some(
                (tail) => name === `/${row.serviceName}-pr-${p.prNumber}${tail}`,
              ),
            ),
        );
    const suffix = networkSuffixForOwner(container.Id, row, previewId, scope);
    return { projectSlug: row.projectSlug, suffix };
  }
  return { resolve, previews: previews.filter((p) => p.state === "active") };
}

export async function reconcileDockerNetworks(): Promise<number> {
  // oxlint-disable-next-line node/no-process-env -- runtime selection boundary
  if (process.env.DEPLOY_RUNTIME === "swarm") return 0;
  const targets = await networkTargets();
  const docker = Docker.fromEnv();
  let moved = 0;
  try {
    const listed = await docker.containers.list({
      all: true,
      filters: { label: ["otterdeploy.managed=true"] },
    });
    if (listed.isErr()) throw listed.error;
    for (const container of listed.value) {
      const target = targets.resolve(container);
      if (!target) continue;
      const network = await ensureBridgeNetwork(docker, target.projectSlug, target.suffix);
      await moveToScopedNetwork(docker, container.Id, target.projectSlug, network);
      moved++;
    }
    for (const scope of targets.previews) await ensurePreviewDatabaseAccess(scope.id);
    return moved;
  } finally {
    docker.destroy();
  }
}

/** Refuse unresolved ownership instead of silently placing it in production. */
export function networkSuffixForOwner(
  containerId: string,
  row: { environmentId: string | null; mainId: string | null; environmentSlug: string | null },
  previewId: string | null | undefined,
  scope: PreviewScope | undefined,
): string {
  if (previewId && !scope)
    throw new Error(`Cannot isolate container ${containerId}: preview missing`);
  if (row.environmentId && row.environmentId !== row.mainId && !row.environmentSlug) {
    throw new Error(`Cannot isolate container ${containerId}: environment missing`);
  }
  return scope
    ? networkScopeSuffix(scope)
    : networkScopeSuffix({
        kind: "environment",
        slug: row.environmentSlug ?? "",
        isMain: !row.environmentId || row.environmentId === row.mainId,
      });
}
