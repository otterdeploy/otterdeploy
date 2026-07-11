/**
 * Reclaim the HOST artifacts a service leaves behind, shared by both delete
 * entry points — the manifest-apply teardown (`deleteService`, what the UI
 * actually calls) and the direct `deleteProjectResource` path. Removing the
 * container is the caller's job (they already do it); this handles the parts
 * that otherwise leak disk: the built images (~2GB per commit sha), the buildx
 * layer cache, and the resource's volumes.
 *
 * Every step is BEST-EFFORT — the DB rows are the source of truth and are
 * removed by the caller regardless, so a cleanup hiccup (a stopped daemon, a
 * missing dir) must never fail the delete.
 */
import type { ProjectId, ResourceId } from "@otterdeploy/shared/id";
import type { RequestLogger } from "evlog";

import { DATA_ROOT, volumeDir } from "@otterdeploy/shared/paths";
import { rm } from "node:fs/promises";
import { join } from "node:path";

export async function reclaimServiceHostArtifacts(
  serviceName: string,
  projectId: ProjectId,
  resourceId: ResourceId,
  log?: RequestLogger,
): Promise<void> {
  // Lazy-imported: @otterdeploy/docker transitively loads env/server (validated
  // at module load) — keep that out of the import graph so env-less callers
  // (and unit tests) can import this module freely.
  const { Docker } = await import("@otterdeploy/docker");

  // Built images for this service — every tag (`:latest` + one per built sha).
  // Only the local build repo; externally-pulled images are shared, left alone.
  const repo = `otterdeploy-local/${serviceName.toLowerCase()}`;
  const docker = Docker.fromEnv();
  try {
    const listed = await docker.images.list({ all: false });
    if (listed.isOk()) {
      const ids = new Set(
        listed.value
          .filter((img) => (img.RepoTags ?? []).some((t) => t.startsWith(`${repo}:`)))
          .map((img) => img.Id),
      );
      for (const id of ids) {
        await docker.images
          .getImage(id)
          .remove({ force: true })
          .catch(() => undefined);
      }
    }
  } finally {
    docker.destroy();
  }

  // Persistent buildx layer-cache dir (path matches the builder's cachePathFor:
  // unsafe chars → `_`).
  const cacheKey = repo.replace(/[^A-Za-z0-9_.-]+/g, "_");
  await rm(join(DATA_ROOT, "buildx-cache", cacheKey), { recursive: true, force: true }).catch(
    () => undefined,
  );

  // The resource's volume dir (bind-mounted service volumes live here).
  await rm(volumeDir(projectId, resourceId), { recursive: true, force: true }).catch(
    () => undefined,
  );

  log?.set({ hostReclaim: { serviceName, images: repo, done: true } });
}
