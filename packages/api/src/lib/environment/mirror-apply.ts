/**
 * Keep a project's manifest overlays in step with its environment rows.
 *
 * The pure overlay edits live in ./mirror; this is the DB side. Both operations
 * are best-effort and deliberately never fail their caller:
 *
 *   - Creating an environment whose overlay could not be written still leaves a
 *     usable environment. The overlay is created lazily on the next apply
 *     rather than blocking the create with a manifest error the operator did
 *     not ask about.
 *   - Deleting an environment whose overlay could not be removed leaves an
 *     inert block behind. Worth logging, not worth refusing a delete over.
 *
 * A project with no manifest yet is a no-op in both directions. There is
 * nothing to overlay onto, and the first manifest save will carry whatever
 * environments exist by then.
 */
import type { OrganizationId, ProjectId } from "@otterdeploy/shared/id";

import { Result } from "better-result";
import { log } from "evlog";

import { loadManifest, saveManifest } from "../../routers/project/manifest";
import { withEnvironmentOverlay, withoutEnvironmentOverlay } from "./mirror";

type Edit = (
  manifest: Parameters<typeof withEnvironmentOverlay>[0],
  slug: string,
) => ReturnType<typeof withEnvironmentOverlay>;

async function editOverlay(
  scope: { projectId: ProjectId; organizationId: OrganizationId },
  slug: string,
  edit: Edit,
  step: string,
): Promise<void> {
  const done = await Result.tryPromise({
    try: async () => {
      const loaded = await loadManifest(scope);
      if (loaded.isErr() || !loaded.value.manifest) return;

      const next = edit(loaded.value.manifest, slug);
      // Identity means nothing changed. Skip the write so re-creating an
      // environment does not bump the manifest version and light up a pending
      // change on every other client.
      if (next === loaded.value.manifest) return;

      await saveManifest(scope, { manifest: next, expectedVersion: loaded.value.version });
    },
    catch: (cause) => cause,
  });
  if (done.isErr()) {
    log.warn({ manifest: { step, slug, projectId: scope.projectId }, err: done.error });
  }
}

/** Give a newly created environment its (empty) mirror overlay. */
export async function ensureEnvironmentOverlay(
  scope: { projectId: ProjectId; organizationId: OrganizationId },
  slug: string,
): Promise<void> {
  await editOverlay(scope, slug, withEnvironmentOverlay, "environment-overlay-add");
}

/** Drop a deleted environment's overlay so the slug can be reused cleanly. */
export async function dropEnvironmentOverlay(
  scope: { projectId: ProjectId; organizationId: OrganizationId },
  slug: string,
): Promise<void> {
  await editOverlay(scope, slug, withoutEnvironmentOverlay, "environment-overlay-drop");
}
