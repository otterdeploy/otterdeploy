import type { DeploymentId, ProjectId, ResourceId } from "@otterdeploy/shared/id";
import type { RequestLogger } from "evlog";

import { hasPrefix, ID_PREFIX } from "@otterdeploy/shared/id";
import { resourceDir, type ResourceRef } from "@otterdeploy/shared/paths";
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
import { deleteProxyRoutesByResource } from "../../caddy/queries";
import { materializeComposeFiles, readEnvFiles } from "../../lib/compose-materialize";
import { createStackDeployLog } from "../../lib/deploy-log";
import { parseCompose } from "../../stack/compose";
import { insertDeployment, markDeploymentFailed } from "../project/deployments";
import { getProjectById, loadProjectEnvBag } from "../project/queries";
import { finalizeStackDeployment } from "./deploy-finalize";
import { interpolate } from "./env";
import { loadManifestServiceEnv } from "./manifest-service-env";
import { type ComposeRecord, getComposeRecord } from "./queries";
import { reconcileStackServices } from "./reconcile";

class ComposeDeployError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ComposeDeployError";
  }
}

/** Message for an empty-content deploy. A git stack shouldn't reach a direct
 *  deploy (it goes through the builder), so empty content there means its first
 *  build hasn't finished, point the user at redeploy rather than "empty file". */
function emptyContentError(source: string): ComposeDeployError {
  return new ComposeDeployError(
    source === "git"
      ? "This git stack hasn't finished its first build yet. Redeploy to build it."
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
  ref: ResourceRef,
  projectVars: Record<string, string>,
): Promise<{ stackDir: string | undefined; missing: string[] }> {
  if (record.compose.files.length === 0) return { stackDir: undefined, missing: [] };
  // Only files that asked for it (ComposeFile.interpolate) get `${VAR}`
  // resolved. Doing it to every file would empty the `${HOME}` out of a
  // bind-mounted shell script, which `docker compose` never does either.
  //
  // Unresolved refs are collected rather than left to render empty. A config
  // file is not env: a service reading `authSecret: ""` fails deep inside its
  // own startup with a message about ITS schema, so the operator learns their
  // variable was blank from a stack trace in someone else's product. Worse,
  // some keys (an encryption key, a signing secret) don't fail at all: they
  // produce a silently insecure install. Refusing the deploy names the
  // variable instead. See NETBIRD_AUTH_SECRET, which crash-looped exactly
  // this way.
  const missing = new Set<string>();
  const files = record.compose.files.map((f) =>
    f.interpolate ? { ...f, content: interpolate(f.content, projectVars, missing) } : f,
  );
  if (missing.size > 0) return { stackDir: undefined, missing: [...missing].sort() };
  const stackDir = await materializeComposeFiles(files, resourceDir(ref));
  for (const svc of parsed.services) {
    if (svc.envFile.length === 0) continue;
    const fromFiles = await readEnvFiles(svc.envFile, stackDir);
    svc.env = { ...fromFiles, ...svc.env };
  }
  return { stackDir, missing: [] };
}

export async function deployCompose(
  input: {
    projectId: ProjectId;
    resourceId: ResourceId;
    /** Reuse an existing build deployment instead of opening a new one. The
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
  // Narrow the row's plain-string org id to the branded type with a real
  // runtime check (ids are minted as `org_…`) instead of an assertion.
  const organizationId = project.organizationId;
  if (!hasPrefix(organizationId, ID_PREFIX.organization)) {
    return Result.err(new ComposeDeployError("Project has a malformed organization id"));
  }

  // Invariant: only inline stacks reach a direct deploy. Git stacks always go
  // through the build worker (compose/index.ts redeploy + create, and
  // manifest-reconcile), which clones, builds, and persists `composeContent`
  // before deploying. So empty content here means a git stack slipped through
  // (e.g. a build that never finished). Surface it as such, not "empty file".
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

  // The stack's on-disk home is env-keyed (null environmentId = main env).
  const materialized = await materializeInlineTree(
    record,
    parsed.value,
    {
      organizationId,
      projectId: input.projectId,
      environmentId: record.resource.environmentId ?? null,
      resourceId: input.resourceId,
    },
    projectVars,
  );
  if (materialized.missing.length > 0) {
    return Result.err(
      new ComposeDeployError(
        `These stack variables have no value, and this stack's config files need them: ` +
          `${materialized.missing.join(", ")}. Set them under Variables, then redeploy.`,
      ),
    );
  }
  const stackDir = materialized.stackDir;

  // `build:` services need an image the build worker produced. Resolve each
  // service's image from `image:` or the builder's `builtImages` map, then
  // apply compose `${VAR:-default}` interpolation (the `image:` field uses it
  // too, not just env). A service with no image yet hasn't been built.
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
  // Direct deploys start at "pending", not "building". An image-only stack
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
      `Deploying stack ${record.compose.stackName}: ${parsed.value.services.length} service(s), reason: ${reason}`,
    );
    if (stackDir) {
      dlog.line(`Materialized ${record.compose.files.length} inline file(s) to ${stackDir}`);
    }

    // Materialize each compose service as a real service_resource owned by the
    // stack, then deploy each via the normal per-service path. This is what makes
    // logs / variables / settings / public-private work per service unchanged.
    //
    // Seed-only exposure: `record.compose.exposed` is the wizard/manifest's
    // one-time selection of which compose services should start out public,
    // never edited after create (there is no stack-level "Save exposures"
    // path anymore; public exposure is owned exclusively by each child
    // service's own Settings tab). reconcileStackServices applies this seed
    // via the normal per-service `exposeService` primitive, ONLY the first
    // time each service is materialized, so it never overwrites an operator's
    // later imperative expose/unexpose. An entry's `domain` (when the
    // wizard/manifest named one) is the public host the seed publishes at.
    const exposedSeeds = new Map(record.compose.exposed.map((e) => [e.service, e.domain]));
    // The manifest's per-child env, layered over the file's defaults the first
    // time each child materializes. See manifest-service-env.ts (od-uhot).
    const manifestServiceEnv = await loadManifestServiceEnv(
      input.projectId,
      organizationId,
      record.resource.name,
    );

    const reconciled = await Result.tryPromise({
      try: () =>
        reconcileStackServices(
          parsed.value,
          {
            projectId: input.projectId,
            organizationId,
            exposedSeeds,
            manifestServiceEnv,
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

    return Result.ok({ status, deployed, failed });
  } finally {
    await dlog.close();
  }
}

/** Drop a stack's routes + re-render Caddy (used on stack delete, cleans up
 *  both the child services' own routes and any legacy stack-level route a
 *  pre-migration exposure left behind). */
export async function removeComposeDomains(resourceId: ResourceId): Promise<void> {
  await deleteProxyRoutesByResource(resourceId);
  await reconcile();
}
