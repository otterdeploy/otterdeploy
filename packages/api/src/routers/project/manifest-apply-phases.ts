/**
 * Phase runners for the manifest reconciler. Each phase fans its resources out
 * with Promise.all (resources within a phase are independent once the prior
 * phase settled) and folds the results into a PhaseContribution the
 * orchestrator sums. Execution order is owned by applyManifest in
 * ./manifest-apply.
 */
import type { OrganizationId, ProjectId, ResourceId } from "@otterdeploy/shared/id";
import type { RequestLogger } from "evlog";

import { db } from "@otterdeploy/db";
import { resource } from "@otterdeploy/db/schema/project";
import { Result } from "better-result";
import { eq } from "drizzle-orm";

import { type Change, type CurrentState, type Manifest } from "../../stack/manifest";
import { createComposeFromManifest } from "../compose/manifest-reconcile";
import { deleteService } from "../service/handlers";
import { ManifestApplySkipError } from "./errors";
import { createDatabase, updateDatabaseFromManifest } from "./manifest-apply-databases";
import { enqueueGitBuild } from "./manifest-apply-git";
import { lookupDatabaseId, lookupServiceId } from "./manifest-apply-support";

type OrgId = OrganizationId;

export interface ApplyContext {
  projectId: ProjectId;
  organizationId: OrgId;
  manifest: Manifest;
  current: CurrentState;
  log: RequestLogger;
}

export interface GitBuild {
  resourceId: ResourceId;
  name: string;
}

export interface PhaseContribution {
  applied: number;
  skipped: ManifestApplySkipError[];
  gitBuilds: GitBuild[];
}

// Fold a batch of per-resource Results into a contribution: ok → applied++,
// err → skipped. Nulls (resource without a spec / missing id) are ignored.
function tallyResults(
  results: Array<Result<unknown, ManifestApplySkipError> | null>,
): PhaseContribution {
  let applied = 0;
  const skipped: ManifestApplySkipError[] = [];
  for (const r of results) {
    if (!r) continue;
    if (r.isOk()) applied += 1;
    else skipped.push(r.error);
  }
  return { applied, skipped, gitBuilds: [] };
}

// ── 1. Database creates ────────────────────────────────────────────────
export async function runDatabaseCreates(
  ctx: ApplyContext,
  changes: Change[],
): Promise<PhaseContribution> {
  const results = await Promise.all(
    changes.flatMap((change) => {
      const spec = ctx.manifest.databases[change.name];
      if (!spec) return [];
      return [
        createDatabase({
          projectId: ctx.projectId,
          organizationId: ctx.organizationId,
          name: change.name,
          spec,
          log: ctx.log,
        }),
      ];
    }),
  );
  return tallyResults(results);
}

// ── 4b. Compose stack creates ──────────────────────────────────────────
export async function runComposeCreates(
  ctx: ApplyContext,
  changes: Change[],
): Promise<PhaseContribution> {
  const results = await Promise.all(
    changes.flatMap((change) => {
      const spec = ctx.manifest.composes[change.name];
      if (!spec) return [];
      return [
        createComposeFromManifest({
          projectId: ctx.projectId,
          organizationId: ctx.organizationId,
          name: change.name,
          spec,
          log: ctx.log,
        }),
      ];
    }),
  );
  return tallyResults(results);
}

// ── 5. Database updates ────────────────────────────────────────────────
export async function runDatabaseUpdates(
  ctx: ApplyContext,
  changes: Change[],
): Promise<PhaseContribution> {
  const results = await Promise.all(
    changes.map(async (change) => {
      const spec = ctx.manifest.databases[change.name];
      const existingId = await lookupDatabaseId(ctx.projectId, change.name);
      if (!spec || !existingId) return null;
      return updateDatabaseFromManifest({
        projectId: ctx.projectId,
        organizationId: ctx.organizationId,
        name: change.name,
        resourceId: existingId,
        spec,
        currentExtraEnv: ctx.current.databases[change.name]?.extraEnv ?? {},
        log: ctx.log,
      });
    }),
  );
  return tallyResults(results);
}

// ── 6. Service deletes ─────────────────────────────────────────────────
export async function runServiceDeletes(
  ctx: ApplyContext,
  changes: Change[],
): Promise<PhaseContribution> {
  const results = await Promise.all(
    changes.map(async (change) => {
      const existingId = await lookupServiceId(ctx.projectId, change.name);
      if (!existingId) return null;
      const result = await deleteService(
        { projectId: ctx.projectId, organizationId: ctx.organizationId, resourceId: existingId },
        ctx.log,
      );
      return { name: change.name, result };
    }),
  );
  let applied = 0;
  const skipped: ManifestApplySkipError[] = [];
  for (const r of results) {
    if (!r) continue;
    if (r.result.isOk()) applied += 1;
    else
      skipped.push(
        new ManifestApplySkipError({
          resource: "service",
          name: r.name,
          reason: `delete failed: ${r.result.error.name}`,
        }),
      );
  }
  return { applied, skipped, gitBuilds: [] };
}

// ── 7. Database deletes ────────────────────────────────────────────────
export async function runDatabaseDeletes(
  ctx: ApplyContext,
  changes: Change[],
): Promise<PhaseContribution> {
  const results = await Promise.all(
    changes.map(async (change) => {
      const existingId = await lookupDatabaseId(ctx.projectId, change.name);
      if (!existingId) return false;
      await db.delete(resource).where(eq(resource.id, existingId));
      return true;
    }),
  );
  let applied = 0;
  for (const ok of results) if (ok) applied += 1;
  return { applied, skipped: [], gitBuilds: [] };
}

// ── Enqueue builds for git-sourced service creates/updates ─────────────
export async function runGitBuilds(
  ctx: ApplyContext,
  gitBuilds: GitBuild[],
): Promise<ManifestApplySkipError[]> {
  const buildResults = await Promise.all(
    gitBuilds.map(async (b) => ({
      name: b.name,
      enqueued: await enqueueGitBuild({
        projectId: ctx.projectId,
        organizationId: ctx.organizationId,
        resourceId: b.resourceId,
        log: ctx.log,
      }),
    })),
  );
  const skipped: ManifestApplySkipError[] = [];
  for (const { name, enqueued } of buildResults) {
    if (enqueued.isErr()) {
      skipped.push(
        new ManifestApplySkipError({
          resource: "service",
          name,
          reason: `created but build not started: ${enqueued.error}`,
        }),
      );
    }
  }
  return skipped;
}
