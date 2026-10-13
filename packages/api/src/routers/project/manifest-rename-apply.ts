/**
 * The `manifest.rename` orchestration: load, check the rename is allowed,
 * transform, save.
 *
 * Separate from manifest-rename.ts on purpose. That file is a pure manifest
 * transform with no database imports, so its tests run without a configured
 * environment; pulling `loadCurrentState` into it made those pure tests fail
 * on "Invalid environment variables". The I/O lives here instead.
 */

import { db } from "@otterdeploy/db";
import { resource } from "@otterdeploy/db/schema/project";
import { and, eq } from "drizzle-orm";

import { ManifestVersionConflictError } from "./errors";
import { loadManifest, saveManifest, type ProjectScope } from "./manifest";
import { renameInManifest, type RenameKind } from "./manifest-rename";

/**
 * Orchestrate a rename: load, check it's allowed, transform, save.
 *
 * Lives here rather than in the router so the router file stays inside its
 * length cap and so the "is this rename legal" reasoning sits next to the
 * transform it guards.
 */
export async function renameResource(
  scope: ProjectScope,
  input: { kind: RenameKind; from: string; to: string },
): Promise<
  | { ok: true; version: number }
  | { ok: false; code: "not-found" }
  | { ok: false; code: "rejected"; message: string }
> {
  const loaded = await loadManifest(scope);
  if (loaded.isErr() || !loaded.value.manifest) return { ok: false, code: "not-found" };
  const manifest = loaded.value.manifest;

  // Only a PENDING resource may be renamed. A deployed one has its container,
  // swarm service and volume names derived from this name (buildContainerName
  // / buildVolumeName), so renaming the manifest key alone would repoint the
  // project at infrastructure that doesn't exist, and for a database, away
  // from the volume holding its data. Deployed ANYWHERE: the manifest is
  // shared, so renaming one that runs only in staging reads there as a delete
  // of the running resource plus a create of a new, empty one.
  if (await deployedInAnyEnvironment(scope, input.kind, input.from)) {
    return {
      ok: false,
      code: "rejected",
      message: `"${input.from}" is already deployed. Renaming a running resource isn't supported yet. Its container and volume names are derived from this name.`,
    };
  }

  const renamed = renameInManifest({ manifest, kind: input.kind, from: input.from, to: input.to });
  if (!renamed.ok) {
    return {
      ok: false,
      code: "rejected",
      message: {
        "not-found": `No pending ${input.kind} named "${input.from}".`,
        "name-taken": `"${input.to}" is already used by another resource in this project.`,
        "same-name": "That's the name it already has.",
      }[renamed.error.code],
    };
  }

  const saved = await saveManifest(scope, {
    manifest: renamed.manifest,
    expectedVersion: loaded.value.version,
  });
  if (saved.isErr()) {
    return saved.error instanceof ManifestVersionConflictError
      ? {
          ok: false,
          code: "rejected",
          message: "The manifest changed underneath you. Reload and retry.",
        }
      : { ok: false, code: "not-found" };
  }
  return { ok: true, version: saved.value.version };
}

/** Whether a resource of this kind and name exists in any of the project's
 *  environments. */
async function deployedInAnyEnvironment(
  scope: ProjectScope,
  kind: RenameKind,
  name: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: resource.id })
    .from(resource)
    .where(
      and(
        eq(resource.projectId, scope.projectId),
        eq(resource.type, kind),
        eq(resource.name, name),
      ),
    )
    .limit(1)
    .$withCache(false);
  return row !== undefined;
}
