/**
 * Per-preview env overrides — the preview panel's "specific envs" editor.
 * Overrides live on (serviceResourceId, previewId, key), win over base rows
 * only when resolving inside that preview, and die with the preview row.
 * A change redeploys the preview with its latest built image so the running
 * container picks it up; with no successful build yet the change simply
 * applies to the next build.
 */
import type { PreviewId, ProjectId, ResourceId } from "@otterdeploy/shared/id";
import type { RequestLogger } from "evlog";

import { db } from "@otterdeploy/db";
import { deployment } from "@otterdeploy/db/schema/project";
import { Result } from "better-result";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { log as globalLog } from "evlog";

import type { ProjectRef } from "../scopes";

import { resolveServiceEnv } from "../../lib/variables";
import { listServiceEnvVars } from "../service/queries";
import {
  deletePreviewServiceEnvVar,
  listPreviewServiceEnvVars,
  upsertPreviewServiceEnvVar,
} from "../service/queries";
import { redeployOne } from "../service/redeploy";
import { ProjectNotFoundError } from "./errors";
import { getPreviewById, getProjectInOrg, getResourceById } from "./queries";

interface PreviewEnvScope extends ProjectRef {
  previewId: PreviewId;
  serviceResourceId: ResourceId;
}

/** Resolve + authorize the scope: project in org, preview in project. */
async function guard(
  input: PreviewEnvScope,
): Promise<Result<{ projectSlug: string }, ProjectNotFoundError>> {
  const project = await getProjectInOrg({
    projectId: input.projectId,
    organizationId: input.organizationId,
  });
  if (!project) {
    return Result.err(new ProjectNotFoundError({ projectId: input.projectId }));
  }
  const preview = await getPreviewById(input.previewId);
  // Active previews only — set/unset on a CLOSED preview would resurrect a
  // torn-down container (zombie service).
  if (!preview || preview.projectId !== input.projectId || preview.state !== "active") {
    return Result.err(new ProjectNotFoundError({ projectId: input.projectId }));
  }
  // CRITICAL: the serviceResourceId must be a service OF THIS PROJECT. Without
  // this a caller could write an env row against another org's service (the
  // FK only requires the row to exist), and it would surface in that victim's
  // graph/manifest/dependency scans. getResourceById is project-scoped.
  const res = await getResourceById(input.projectId, input.serviceResourceId);
  if (!res || res.kind !== "service") {
    return Result.err(new ProjectNotFoundError({ projectId: input.projectId }));
  }
  return Result.ok({ projectSlug: project.slug });
}

export async function listPreviewEnvOverrides(
  input: PreviewEnvScope,
): Promise<Result<{ key: string; value: string; updatedAt: string }[], ProjectNotFoundError>> {
  const g = await guard(input);
  if (g.isErr()) return Result.err(g.error);
  const rows = await listPreviewServiceEnvVars(input.serviceResourceId, input.previewId);
  return Result.ok(
    rows
      .map((r) => ({ key: r.key, value: r.value, updatedAt: r.updatedAt.toISOString() }))
      .sort((a, b) => a.key.localeCompare(b.key)),
  );
}

export async function setPreviewEnvOverride(
  input: PreviewEnvScope & { key: string; value: string },
  log?: RequestLogger,
): Promise<Result<{ redeployed: boolean }, ProjectNotFoundError>> {
  const g = await guard(input);
  if (g.isErr()) return Result.err(g.error);
  await upsertPreviewServiceEnvVar({
    serviceResourceId: input.serviceResourceId,
    previewId: input.previewId,
    key: input.key,
    value: input.value,
  });
  const redeployed = await redeployPreviewService(input, g.value.projectSlug, log);
  return Result.ok({ redeployed });
}

export async function unsetPreviewEnvOverride(
  input: PreviewEnvScope & { key: string },
  log?: RequestLogger,
): Promise<Result<{ redeployed: boolean }, ProjectNotFoundError>> {
  const g = await guard(input);
  if (g.isErr()) return Result.err(g.error);
  const removed = await deletePreviewServiceEnvVar({
    serviceResourceId: input.serviceResourceId,
    previewId: input.previewId,
    key: input.key,
  });
  if (!removed) return Result.ok({ redeployed: false });
  const redeployed = await redeployPreviewService(input, g.value.projectSlug, log);
  return Result.ok({ redeployed });
}

/** Roll the preview container with its latest BUILT image so the override
 *  takes effect now. Best-effort: no successful build yet (image still
 *  `pending:`) → skip; the next build resolves the override anyway. */
async function redeployPreviewService(
  input: PreviewEnvScope,
  projectSlug: string,
  log?: RequestLogger,
): Promise<boolean> {
  // If a build is in flight for this preview, don't roll — that build's own
  // redeployOne resolves env at deploy time and picks up the override. Rolling
  // now would race it onto a stale image.
  const [newest] = await db
    .select({ status: deployment.status })
    .from(deployment)
    .where(
      and(
        eq(deployment.resourceId, input.serviceResourceId),
        eq(deployment.previewId, input.previewId),
      ),
    )
    .orderBy(desc(deployment.createdAt))
    .limit(1);
  if (newest && (newest.status === "pending" || newest.status === "building")) return false;

  // Prefer the newest RUNNING image; fall back to a failed one only when
  // nothing is running (revive-a-crashed-preview) — never roll a healthy
  // preview onto a known-bad image.
  const [latestBuilt] = await db
    .select({ image: deployment.image })
    .from(deployment)
    .where(
      and(
        eq(deployment.resourceId, input.serviceResourceId),
        eq(deployment.previewId, input.previewId),
        inArray(deployment.status, ["running", "failed"]),
      ),
    )
    .orderBy(
      sql`case when ${deployment.status} = 'running' then 0 else 1 end`,
      desc(deployment.createdAt),
    )
    .limit(1);
  if (!latestBuilt || latestBuilt.image.startsWith("pending:")) return false;

  const rolled = await Result.tryPromise({
    try: () =>
      redeployOne(input.projectId as ProjectId, input.serviceResourceId, projectSlug, log, {
        previewId: input.previewId,
        imageOverride: latestBuilt.image,
      }),
    catch: (cause) => cause,
  });
  if (rolled.isErr()) {
    globalLog.warn({
      preview: { step: "env-override-redeploy", previewId: input.previewId },
      err: rolled.error,
    });
    return false;
  }
  if (rolled.value.isErr()) {
    globalLog.warn({
      preview: { step: "env-override-redeploy", previewId: input.previewId },
      err: rolled.value.error,
    });
    return false;
  }
  return true;
}

/** Effective env for a service INSIDE a preview: every base var plus this
 *  preview's overrides, each marked inherited|override with the base value for
 *  overridden keys, and fully ref-resolved values so the panel shows what the
 *  container will actually run with. */
export interface EffectiveEnvRow {
  key: string;
  value: string;
  source: "inherited" | "override";
  baseValue: string | null;
  isSecret: boolean;
  /** True when ref resolution failed for this value — the UI shows the raw
   *  declared value and an "unresolved" hint instead of a blank. */
  unresolved: boolean;
}

export async function listPreviewEffectiveEnv(
  input: PreviewEnvScope,
): Promise<Result<EffectiveEnvRow[], ProjectNotFoundError>> {
  const g = await guard(input);
  if (g.isErr()) return Result.err(g.error);

  // Base (previewId-null) rows for this service — the inherited layer.
  const baseRows = await listServiceEnvVars(input.serviceResourceId);
  const baseByKey = new Map(baseRows.map((r) => [r.key, r]));
  // Declared overrides for this preview.
  const overrides = await listPreviewServiceEnvVars(input.serviceResourceId, input.previewId);
  const overrideByKey = new Map(overrides.map((r) => [r.key, r]));

  // Fully-resolved effective values (refs expanded against the preview scope).
  const resolved = await resolveServiceEnv(
    input.projectId as ProjectId,
    input.serviceResourceId,
    input.previewId,
  );
  const resolvedByKey = resolved.isOk() ? resolved.value : {};
  const resolveOk = resolved.isOk();

  const keys = new Set<string>([...baseByKey.keys(), ...overrideByKey.keys()]);
  return Result.ok(
    [...keys]
      .map((key): EffectiveEnvRow => {
        const override = overrideByKey.get(key);
        const base = baseByKey.get(key);
        const declared = override ?? base;
        const source: "inherited" | "override" = override ? "override" : "inherited";
        // Prefer the resolved value; on resolver failure fall back to the raw
        // declared value so the tab never blanks (RefMissingResource etc.).
        const resolvedVal = resolvedByKey[key];
        const unresolved = !resolveOk && resolvedVal === undefined;
        const value = resolvedVal ?? declared?.value ?? "";
        const isSecret = (base?.isSecret ?? false) || (override?.isSecret ?? false);
        return {
          key,
          // Mask secrets — never return cleartext to the client.
          value: isSecret && value.length > 0 ? "••••••••" : value,
          source,
          baseValue: override ? (isSecret ? "••••••••" : (base?.value ?? null)) : null,
          isSecret,
          unresolved,
        };
      })
      .sort((a, b) => a.key.localeCompare(b.key)),
  );
}
