/**
 * Snapshot loader for the PR preview report — assembles everything the sticky
 * comment + commit status need for one (repo, PR): the GitHub write-back
 * identity (numeric installation id, owner/repo), the head SHA, and one row
 * per (project, git service) with its latest env-scoped deployment, preview
 * host and dashboard inspect link. Read-only; rendering lives in
 * preview-comment.ts, GitHub calls in preview-report.ts.
 */
import type { GitRepoId, ProjectId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { organization } from "@otterdeploy/db/schema/auth";
import { gitInstallation, gitRepo } from "@otterdeploy/db/schema/git";
import {
  deployment,
  preview,
  project,
  resource,
  serviceResource,
} from "@otterdeploy/db/schema/project";
import { env as serverEnv } from "@otterdeploy/env/server";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";

import type { PreviewCommentRow } from "./preview-comment";

import { listProxyRoutesByPreview } from "../caddy/queries";
import { rowStatusFromDeployment } from "./preview-comment";

export interface PreviewReportSnapshot {
  /** GitHub-numeric installation id (what token minting needs) — null when
   *  the repo has no App installation (public repo / soft-revoked). */
  installationId: string | null;
  owner: string | undefined;
  repo: string | undefined;
  prNumber: number;
  headSha: string;
  /** True when every preview for this PR is closed. */
  tornDown: boolean;
  rows: PreviewCommentRow[];
}

type PreviewRow = typeof preview.$inferSelect;

function dashboardBase(): string {
  return serverEnv.BETTER_AUTH_URL.replace(/\/+$/, "");
}

/** One comment row per git service the PR rebuilds in this preview's project. */
async function loadPreviewRows(row: PreviewRow, repoId: GitRepoId): Promise<PreviewCommentRow[]> {
  const [proj] = await db
    .select({ name: project.name, slug: project.slug, orgSlug: organization.slug })
    .from(project)
    .innerJoin(organization, eq(organization.id, project.organizationId))
    .where(eq(project.id, row.projectId as ProjectId))
    .limit(1);
  if (!proj) return [];

  const services = await db
    .select({ resourceId: resource.id, name: resource.name })
    .from(resource)
    .innerJoin(serviceResource, eq(serviceResource.resourceId, resource.id))
    .where(
      and(
        eq(resource.projectId, row.projectId as ProjectId),
        eq(resource.type, "service"),
        eq(serviceResource.source, "git"),
        eq(serviceResource.gitRepoId, repoId),
        eq(serviceResource.previewsEnabled, true),
        isNull(resource.previewId),
      ),
    );
  if (services.length === 0) return [];

  const deployments = await db
    .select()
    .from(deployment)
    .where(
      and(
        eq(deployment.previewId, row.id),
        inArray(
          deployment.resourceId,
          services.map((s) => s.resourceId),
        ),
      ),
    )
    .orderBy(desc(deployment.createdAt));
  const latestByResource = new Map<string, (typeof deployments)[number]>();
  for (const dep of deployments) {
    if (!latestByResource.has(dep.resourceId)) latestByResource.set(dep.resourceId, dep);
  }

  const routes = await listProxyRoutesByPreview(row.id);
  const base = dashboardBase();

  return services.map((svc) => {
    const dep = latestByResource.get(svc.resourceId);
    const route = routes.find((r) => r.resourceId === svc.resourceId);
    return {
      projectName: proj.name,
      serviceName: svc.name,
      status: rowStatusFromDeployment(dep?.status),
      inspectUrl: dep
        ? `${base}/${proj.orgSlug}/${proj.slug}/graph/${svc.resourceId}/deployment/${dep.id}`
        : null,
      previewUrl: route ? `https://${route.domain}` : null,
      updatedAt: dep ? (dep.completedAt ?? dep.updatedAt) : null,
    };
  });
}

export async function loadPreviewReportSnapshot(
  repoId: GitRepoId,
  prNumber: number,
): Promise<PreviewReportSnapshot | null> {
  const [repo] = await db.select().from(gitRepo).where(eq(gitRepo.id, repoId)).limit(1);
  if (!repo) return null;
  const [owner, repoName] = repo.fullName.split("/");

  // gitRepo.installationId is the INTERNAL `gitinst_` PK; GitHub's token API
  // needs the numeric installation id off the gitInstallation row.
  let installationId: string | null = null;
  if (repo.installationId) {
    const [inst] = await db
      .select({ installationId: gitInstallation.installationId })
      .from(gitInstallation)
      .where(eq(gitInstallation.id, repo.installationId))
      .limit(1);
    installationId = inst?.installationId ?? null;
  }

  const previews = await db
    .select()
    .from(preview)
    .where(and(eq(preview.gitRepoId, repoId), eq(preview.prNumber, prNumber)));
  if (previews.length === 0) return null;

  const rows: PreviewCommentRow[] = [];
  for (const row of previews) {
    rows.push(...(await loadPreviewRows(row, repoId)));
  }

  return {
    installationId,
    owner,
    repo: repoName,
    prNumber,
    headSha: previews.find((e) => e.headSha)?.headSha ?? "",
    tornDown: previews.every((e) => e.state === "closed"),
    rows,
  };
}
