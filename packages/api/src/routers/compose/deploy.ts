/**
 * Deploy a `type: compose` resource: parse the stored file → resolve each
 * service's env against the project bag → build a `SwarmServiceSpec` per
 * service → apply the whole set as one stack via `deployComposeStack`, with a
 * single deployment row tracking the rollout.
 *
 * v1 handles image-only stacks. Services with a `build:` context need the
 * builder (Phase 3) and are rejected with a clear error until then. See
 * docs/designs/compose.md.
 */
import { eq } from "drizzle-orm";
import { Result } from "better-result";
import type { RequestLogger } from "evlog";

import { db } from "@otterdeploy/db";
import { deployment } from "@otterdeploy/db/schema/project";
import type {
  DeploymentId,
  ProjectId,
  ResourceId,
} from "@otterdeploy/shared/id";

import { reconcile } from "../../caddy";
import {
  deleteProxyRoutesByResource,
  insertProxyRoute,
} from "../../caddy/queries";
import { loadDomainSourcesForProject } from "../../lib/domain-sources";
import { resolvePublicDomain } from "../../lib/domains";
import { parseCompose } from "../../stack/compose";
import { insertDeployment, markDeploymentFailed } from "../project/deployments";
import { getProjectById, loadProjectEnvBag } from "../project/queries";
import { reconcileStackServices } from "./reconcile";
import { interpolate } from "./env";
import { type ComposeRecord, getComposeRecord } from "./queries";

const sanitize = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

class ComposeDeployError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ComposeDeployError";
  }
}

export interface ComposeDeployResult {
  /** running = all services rolled out; partial = some failed; failed = none. */
  status: "running" | "partial" | "failed";
  deployed: number;
  /** Compose service names that failed to roll out. */
  failed: string[];
}

export async function deployCompose(
  input: {
    projectId: ProjectId;
    resourceId: ResourceId;
    /** Reuse an existing build deployment instead of opening a new one — the
     *  build worker passes its own; the caller then owns status transitions. */
    deploymentId?: DeploymentId;
  },
  reason: "create" | "redeploy" | "env-change",
  rlog?: RequestLogger,
): Promise<Result<ComposeDeployResult, ComposeDeployError>> {
  const ownsDeployment = !input.deploymentId;
  const record = await getComposeRecord(input.projectId, input.resourceId);
  if (!record) {
    return Result.err(new ComposeDeployError("Compose resource not found"));
  }
  const project = await getProjectById(input.projectId);
  if (!project) {
    return Result.err(new ComposeDeployError("Project not found"));
  }

  const content = record.compose.composeContent;
  if (!content) {
    return Result.err(
      new ComposeDeployError(
        "Compose file is empty (git-sourced builds not implemented yet)",
      ),
    );
  }

  const parsed = parseCompose(content);
  if (parsed.isErr()) {
    return Result.err(new ComposeDeployError(parsed.error.message));
  }

  const projectVars = project.environmentId
    ? await loadProjectEnvBag({
        projectId: input.projectId,
        environmentId: project.environmentId,
      })
    : {};

  // `build:` services need an image the build worker produced. Resolve each
  // service's image from `image:` or the builder's `builtImages` map, then
  // apply compose `${VAR:-default}` interpolation (the `image:` field uses it
  // too — not just env). A service with no image yet hasn't been built.
  const builtImages = record.compose.builtImages;
  const resolveImage = (svc: { name: string; image: string | null }) => {
    const raw = svc.image ?? builtImages[svc.name] ?? null;
    return raw ? interpolate(raw, projectVars) : null;
  };
  const unbuilt = parsed.value.services.filter((s) => !resolveImage(s));
  if (unbuilt.length > 0) {
    return Result.err(
      new ComposeDeployError(
        `These services have no image yet (build not finished?): ${unbuilt
          .map((s) => s.name)
          .join(", ")}`,
      ),
    );
  }

  // Stack-level deployment row: tracks the rollout as a whole (and is the row
  // the build worker owns for git stacks). Each service ALSO gets its own
  // deployment row inside the reconcile, for per-service history + logs.
  const depId =
    input.deploymentId ??
    (
      await insertDeployment({
        resourceId: input.resourceId,
        image: record.compose.stackName,
        reason,
        snapshot: { compose: content, services: record.compose.services },
      })
    ).id;

  // Materialize each compose service as a real service_resource owned by the
  // stack, then deploy each via the normal per-service path. This is what makes
  // logs / variables / settings / public-private work per service unchanged.
  const reconciled = await Result.tryPromise({
    try: () =>
      reconcileStackServices(
        parsed.value,
        {
          projectId: input.projectId,
          stackResourceId: input.resourceId,
          projectSlug: project.slug,
          stackName: record.compose.stackName,
          projectVars,
          builtImages,
        },
        reason,
        rlog,
      ),
    catch: (e) => (e instanceof Error ? e : new Error(String(e))),
  });

  if (reconciled.isErr()) {
    if (ownsDeployment) await markDeploymentFailed(depId, reconciled.error.message);
    return Result.err(new ComposeDeployError(reconciled.error.message));
  }

  const { deployed, failed } = reconciled.value;
  const status: ComposeDeployResult["status"] =
    failed.length === 0 ? "running" : deployed === 0 ? "failed" : "partial";

  if (ownsDeployment) {
    if (status === "failed") {
      await markDeploymentFailed(
        depId,
        `No services deployed (${failed.join(", ")} failed)`,
      );
    } else {
      await db
        .update(deployment)
        .set({
          status: "running",
          completedAt: new Date(),
          errorMessage:
            failed.length > 0 ? `Some services failed: ${failed.join(", ")}` : null,
        })
        .where(eq(deployment.id, depId));
    }
  }

  // Best-effort: publish Caddy routes for any exposed service:port. A domain
  // failure must not fail an otherwise-successful stack deploy.
  await Result.tryPromise({
    try: () =>
      reconcileComposeDomains(record, {
        id: input.projectId,
        slug: project.slug,
      }),
    catch: (e) => (e instanceof Error ? e : new Error(String(e))),
  });

  return Result.ok({ status, deployed, failed });
}

/**
 * Rebuild this stack's public routes from its `exposed` list. Idempotent:
 * drops the stack's existing generated routes and re-mints one per exposed
 * `service:port`, pointing Caddy at the swarm service's network alias.
 */
async function reconcileComposeDomains(
  record: ComposeRecord,
  project: { id: ProjectId; slug: string },
): Promise<void> {
  await deleteProxyRoutesByResource(record.resource.id);

  const exposed = record.compose.exposed;
  if (exposed.length > 0) {
    const sources = (await loadDomainSourcesForProject(project.id)) ?? {
      resourceOverride: null,
      projectCustomDomain: null,
      projectCustomDomainVerifiedAt: null,
      orgBaseDomain: null,
      orgBaseDomainVerifiedAt: null,
      localBaseDomain: null,
      serverIp: null,
    };

    let first = true;
    for (const ex of exposed) {
      const serviceName = sanitize(
        `${record.compose.stackName}-${ex.service}`,
      ).slice(0, 63);
      const resolved = resolvePublicDomain(
        { resourceSlug: serviceName, projectSlug: project.slug, kind: "service" },
        { ...sources, resourceOverride: ex.domain || null },
      );
      await insertProxyRoute({
        projectId: project.id,
        resourceId: record.resource.id,
        type: "http",
        domain: resolved.fqdn,
        // Caddy reaches the service by its swarm alias on the project network.
        upstreamHost: serviceName,
        upstreamPort: ex.port,
        protocol: "http",
        usesAcme: resolved.verified && resolved.source !== "sslip-fallback",
        enabled: true,
        source: "generated",
        isPrimary: first,
        dnsState: "pointed",
      });
      first = false;
    }
  }

  await reconcile();
}

/** Drop a stack's routes + re-render Caddy (used on stack delete). */
export async function removeComposeDomains(
  resourceId: ResourceId,
): Promise<void> {
  await deleteProxyRoutesByResource(resourceId);
  await reconcile();
}
