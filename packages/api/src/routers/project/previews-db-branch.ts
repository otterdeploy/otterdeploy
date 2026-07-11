/**
 * Preview DB-branch controls — enable/disable/reset an isolated database
 * branch for one preview. Split out of previews-controls.ts (which keeps the
 * lifecycle actions and re-exports these for the router).
 */
import type { ProjectId } from "@otterdeploy/shared/id";
import type { RequestLogger } from "evlog";

import { Result } from "better-result";

import { branchProjectDatabases } from "../../git/preview-db";
import { destroyPreviewBranchDbs } from "../../git/preview-teardown";
import { ProjectNotFoundError } from "./errors";
import { guard, rollFromLastImage, type PreviewControlScope } from "./previews-control-helpers";

/** Enable an isolated DB branch for this preview NOW (regardless of the base
 *  per-database opt-in), then roll services so ${{db.*}} re-resolves to the
 *  branch. Idempotent — branchProjectDatabases skips already-branched DBs. */
export async function enablePreviewDbBranch(
  input: PreviewControlScope,
  log?: RequestLogger,
): Promise<Result<{ branched: number }, ProjectNotFoundError>> {
  const g = await guard(input);
  if (g.isErr()) return Result.err(g.error);
  const { preview, project } = g.value;
  const branched = await branchProjectDatabases({
    projectId: preview.projectId as ProjectId,
    projectSlug: project.slug,
    previewId: preview.id,
    previewSlug: preview.slug,
    gitRepoId: preview.gitRepoId,
    force: true,
    rlog: log,
  });
  await rollFromLastImage(preview, project.slug, log);
  return Result.ok({ branched });
}

/** Destroy this preview's DB branches; services fall back to the base DB on
 *  the next roll. */
export async function disablePreviewDbBranch(
  input: PreviewControlScope,
  log?: RequestLogger,
): Promise<Result<{ destroyed: number }, ProjectNotFoundError>> {
  const g = await guard(input);
  if (g.isErr()) return Result.err(g.error);
  const { preview, project } = g.value;
  const destroyed = await destroyPreviewBranchDbs(
    {
      id: preview.id,
      projectId: preview.projectId as ProjectId,
      projectSlug: project.slug,
      slug: preview.slug,
    },
    log,
  );
  await rollFromLastImage(preview, project.slug, log);
  return Result.ok({ destroyed });
}

/** Re-seed the branch from current base data: destroy the branch DBs, re-branch
 *  from base, then roll ONCE. Deliberately skips disable's intermediate roll —
 *  that would briefly point services at the base (production) DB. During the
 *  copy the old containers hit the now-gone branch (connection errors, not
 *  production writes), which is the safe failure mode. */
export async function resetPreviewDbBranch(
  input: PreviewControlScope,
  log?: RequestLogger,
): Promise<Result<{ branched: number }, ProjectNotFoundError>> {
  const g = await guard(input);
  if (g.isErr()) return Result.err(g.error);
  const { preview, project } = g.value;
  await destroyPreviewBranchDbs(
    {
      id: preview.id,
      projectId: preview.projectId as ProjectId,
      projectSlug: project.slug,
      slug: preview.slug,
    },
    log,
  );
  const branched = await branchProjectDatabases({
    projectId: preview.projectId as ProjectId,
    projectSlug: project.slug,
    previewId: preview.id,
    previewSlug: preview.slug,
    gitRepoId: preview.gitRepoId,
    force: true,
    rlog: log,
  });
  await rollFromLastImage(preview, project.slug, log);
  return Result.ok({ branched });
}
