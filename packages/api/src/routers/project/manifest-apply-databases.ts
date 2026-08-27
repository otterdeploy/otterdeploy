/**
 * Database UPDATE for the manifest reconciler: the declared-only field
 * reconciliations (public exposure, preview branching, extra env, extensions)
 * plus the refusal that keeps a live database from being re-homed by a
 * one-line manifest edit. Create lives in ./manifest-apply-database-create.
 */
import type { OrganizationId, ProjectId, ResourceId } from "@otterdeploy/shared/id";
import type { RequestLogger } from "evlog";

import { Result } from "better-result";
import { log } from "evlog";

import { branchPlacementConflictForResource } from "../../lib/environment/branch-placement";
import { type DatabaseManifest } from "../../stack/manifest";
import { ManifestApplySkipError } from "./errors";
import { applyPostgresExtraEnv, setPostgresPublic } from "./postgres/env";
import { setPostgresExtensions } from "./postgres/extensions";
import { setDatabaseResourcePreviewBranching } from "./queries";

type OrgId = OrganizationId;

/** Extensions only exist on the postgres manifest variant. Read them off
 *  the spec without assuming the discriminant has been narrowed. Shared with
 *  the create half, which bakes them into the image. */
export function manifestExtensions(spec: DatabaseManifest): string[] {
  const value = "extensions" in spec ? spec.extensions : undefined;
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

interface UpdateDatabaseArgs {
  projectId: ProjectId;
  organizationId: OrgId;
  name: string;
  resourceId: ResourceId;
  spec: DatabaseManifest;
  currentExtraEnv: Record<string, string>;
  currentPublicEnabled: boolean;
  /** Name of the server this database currently lives on, null when it has a
   *  container of its own. */
  currentHost: string | null;
  /** What the manifest declares, or undefined when it declares nothing (in
   *  which case placement is live-managed and left alone). */
  declaredHost: string | null | undefined;
  log: RequestLogger;
}

export async function updateDatabaseFromManifest(
  args: UpdateDatabaseArgs,
): Promise<Result<{ name: string }, ManifestApplySkipError>> {
  // Moving a live database onto (or off) a server means copying its data
  // between engines and cutting over every consumer's connection string. An
  // apply must not do that because one line of a manifest changed, so the
  // diff shows the drift and this refuses it with the reason.
  if (args.declaredHost !== undefined && args.currentHost !== args.declaredHost) {
    return Result.err(
      new ManifestApplySkipError({
        resource: "database",
        name: args.name,
        reason:
          `"${args.name}" already lives ${args.currentHost ? `on server "${args.currentHost}"` : "on its own container"}. ` +
          `Moving it copies data, so create a new database on "${args.declaredHost}" and migrate instead.`,
      }),
    );
  }

  // Only touch public exposure when the manifest explicitly declares it AND
  // it differs. The old unconditional `spec.publicEnabled ?? false` call
  // meant every env-only apply re-rolled the container and silently turned
  // public access OFF whenever the manifest omitted the key.
  if (
    args.spec.publicEnabled !== undefined &&
    args.spec.publicEnabled !== args.currentPublicEnabled
  ) {
    await setPostgresPublic(
      {
        projectId: args.projectId,
        organizationId: args.organizationId,
        resourceId: args.resourceId,
        publicEnabled: args.spec.publicEnabled,
      },
      args.log,
    );
  }

  // Declared-only: opt the database in/out of PR-preview branching. Pure DB
  // flag (no container roll), idempotent, applies to the next PR event.
  if (args.spec.previews !== undefined) {
    await setDatabaseResourcePreviewBranching(args.resourceId, args.spec.previews);
    // Warn rather than refuse. A manifest apply that used to succeed must not
    // start failing on upgrade just because Swarm is enabled, but the operator
    // has to learn about the conflict when they create it, not when a pull
    // request opens and the branch is refused. The hard stop is Blocked, which
    // keeps the preview off production data either way.
    const conflict = await branchPlacementConflictForResource({
      organizationId: args.organizationId,
      resourceId: args.resourceId,
      previewBranching: args.spec.previews,
    });
    if (conflict) {
      log.warn({
        manifest: { step: "preview-branching", resourceId: args.resourceId },
        msg: conflict,
      });
    }
  }

  // Same declared-only rule as publicEnabled above: only touch extraEnv when
  // the manifest declares it AND it differs. Treating an absent map as `{}`
  // used to wipe every live-added env key on any apply (and roll the
  // container doing it).
  if (args.spec.extraEnv !== undefined && !shallowEqual(args.spec.extraEnv, args.currentExtraEnv)) {
    await applyPostgresExtraEnv(
      {
        projectId: args.projectId,
        organizationId: args.organizationId,
        resourceId: args.resourceId,
        nextExtraEnv: args.spec.extraEnv,
      },
      args.log,
    );
  }

  // Reconcile extensions to the manifest's desired set. setPostgresExtensions
  // is idempotent (diffs against the current list), so calling it
  // unconditionally is safe, but skip when the manifest declares none and
  // the resource also has none, to avoid a no-op redeploy.
  const desiredExtensions = manifestExtensions(args.spec);
  if (desiredExtensions.length > 0) {
    await setPostgresExtensions(
      {
        projectId: args.projectId,
        organizationId: args.organizationId,
        resourceId: args.resourceId,
        extensions: desiredExtensions,
      },
      args.log,
    );
  }
  return Result.ok({ name: args.name });
}

function shallowEqual(a: Record<string, string>, b: Record<string, string>): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((k) => a[k] === b[k]);
}
