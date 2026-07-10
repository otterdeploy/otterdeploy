import type { DeploymentId, ProjectId, ResourceId } from "@otterdeploy/shared/id";
import type { RequestLogger } from "evlog";

import { resourceDir } from "@otterdeploy/shared/paths";
import { Result } from "better-result";
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

import { reconcile } from "../../caddy";
import { deleteProxyRoutesByResource, insertProxyRoute } from "../../caddy/queries";
import { materializeComposeFiles, readEnvFiles } from "../../lib/compose-materialize";
import { loadDomainSourcesForProject } from "../../lib/domain-sources";
import { resolvePublicDomain } from "../../lib/domains";
import { parseCompose } from "../../stack/compose";
import { insertDeployment, markDeploymentFailed } from "../project/deployments";
import { getProjectById, loadProjectEnvBag } from "../project/queries";
import { finalizeStackDeployment } from "./deploy-finalize";
import { createStackDeployLog } from "./deploy-log";
import { interpolate } from "./env";
import { type ComposeRecord, getComposeRecord } from "./queries";
import { reconcileStackServices } from "./reconcile";

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

/** Message for an empty-content deploy. A git stack shouldn't reach a direct
 *  deploy (it goes through the builder), so empty content there means its first
 *  build hasn't finished — point the user at redeploy rather than "empty file". */
function emptyContentError(source: string): ComposeDeployError {
  return new ComposeDeployError(
    source === "git"
      ? "This git stack hasn't finished its first build yet — redeploy to build it."
      : "Compose file is empty",
  );
}

export interface ComposeDeployResult {
  /** running = all services rolled out; partial = some failed; failed = none. */
  status: "running" | "partial" | "failed";
  deployed: number;
  /** Compose service names that failed to roll out. */
  failed: string[];
}

/**
 * Multi-file inline stack: write the file tree to disk so bind-mounted scripts
 * resolve and env_file targets are readable, then merge each service's env_file
 * contents into its env (env_file first, `environment:` wins) so the existing
 * per-service env seed picks them up unchanged. Single-file / git stacks carry
 * no `files` and return undefined. The returned absolute dir is where bind
 * sources resolve (reconcile-map).
 */
async function materializeInlineTree(
  record: ComposeRecord,
  parsed: { services: Array<{ envFile: string[]; env: Record<string, string> }> },
  ids: { projectId: ProjectId; resourceId: ResourceId },
): Promise<string | undefined> {
  if (record.compose.files.length === 0) return undefined;
  const stackDir = await materializeComposeFiles(
    record.compose.files,
    resourceDir(ids.projectId, ids.resourceId),
  );
  for (const svc of parsed.services) {
    if (svc.envFile.length === 0) continue;
    const fromFiles = await readEnvFiles(svc.envFile, stackDir);
    svc.env = { ...fromFiles, ...svc.env };
  }
  return stackDir;
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

  // Invariant: only inline stacks reach a direct deploy. Git stacks always go
  // through the build worker (compose/index.ts redeploy + create, and
  // manifest-reconcile), which clones, builds, and persists `composeContent`
  // before deploying. So empty content here means a git stack slipped through
  // (e.g. a build that never finished) — surface it as such, not "empty file".
  const content = record.compose.composeContent;
  if (!content) {
    return Result.err(emptyContentError(record.compose.source));
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

  const stackDir = await materializeInlineTree(record, parsed.value, input);

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
  // Direct deploys start at "pending", not "building" — an image-only stack
  // never builds anything, and the UI renders the states differently.
  const depId =
    input.deploymentId ??
    (
      await insertDeployment({
        resourceId: input.resourceId,
        image: record.compose.stackName,
        reason,
        status: "pending",
        snapshot: { compose: content, services: record.compose.services },
      })
    ).id;

  // Scrollback + live tail for the stack deployment. The builder already logs
  // to this row for git/build stacks; the direct path used to write nothing,
  // leaving the deployment's log view empty.
  const dlog = createStackDeployLog(depId);
  try {
    dlog.line(
      `Deploying stack ${record.compose.stackName} — ${parsed.value.services.length} service(s), reason: ${reason}`,
    );
    if (stackDir) {
      dlog.line(`Materialized ${record.compose.files.length} inline file(s) to ${stackDir}`);
    }

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
            stackDir,
            deployLog: (line) => dlog.line(line),
          },
          reason,
          rlog,
        ),
      catch: (e) => (e instanceof Error ? e : new Error(String(e))),
    });

    if (reconciled.isErr()) {
      dlog.line(`Stack deploy failed: ${reconciled.error.message}`);
      if (ownsDeployment) await markDeploymentFailed(depId, reconciled.error.message);
      return Result.err(new ComposeDeployError(reconciled.error.message));
    }

    const { deployed, failed } = reconciled.value;
    const status = await finalizeStackDeployment({
      depId,
      ownsDeployment,
      deployed,
      failed,
      total: parsed.value.services.length,
      log: (line) => dlog.line(line),
    });

    // Best-effort: publish Caddy routes for any exposed service:port. A domain
    // failure must not fail an otherwise-successful stack deploy.
    if (record.compose.exposed.length > 0) {
      dlog.line(`Publishing ${record.compose.exposed.length} public route(s).`);
    }
    await Result.tryPromise({
      try: () =>
        reconcileComposeDomains(record, {
          id: input.projectId,
          slug: project.slug,
        }),
      catch: (e) => (e instanceof Error ? e : new Error(String(e))),
    });

    return Result.ok({ status, deployed, failed });
  } finally {
    await dlog.close();
  }
}

/**
 * Rebuild this stack's public routes from its `exposed` list. Idempotent:
 * drops the stack's existing generated routes and re-mints one per exposed
 * `service:port`, pointing Caddy at the swarm service's network alias.
 */
export async function reconcileComposeDomains(
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
      const serviceName = sanitize(`${record.compose.stackName}-${ex.service}`).slice(0, 63);
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
export async function removeComposeDomains(resourceId: ResourceId): Promise<void> {
  await deleteProxyRoutesByResource(resourceId);
  await reconcile();
}
