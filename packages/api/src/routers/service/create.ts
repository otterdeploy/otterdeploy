import type { EnvironmentId, ProjectId } from "@otterdeploy/shared/id";
import type { RequestLogger } from "evlog";

/**
 * Creating a service: validate the target machine, mint the docker-visible
 * names, insert the row, then provision it.
 *
 * Its own module because `handlers.ts` is a grab bag at the line cap and this
 * is one cohesive path — and because the create-time placement seed belongs
 * next to the create, not scattered through the rest of the CRUD. Re-exported
 * from `handlers.ts` so no caller had to change.
 */
import { Result } from "better-result";

import type { ProjectNotFoundError } from "../project/errors";

import { resolvePlacementSeed, UnknownPlacementServerError } from "../../lib/placement-seed";
import { insertDeployment, markDeploymentFailed } from "../project/deployments";
import { resolveEnvironmentScope } from "../project/queries/resource";
import { loadProject } from "./context";
import { MissingServiceBuildBindingError, ServiceConflictError, type ResolveError } from "./errors";
import {
  type CreateServiceInput,
  deriveServiceNames,
  missingGitBuildBinding,
  toCreateRecordPayload,
} from "./inputs";
import {
  createServiceRecord,
  getServiceRecord,
  getServiceRecordByName,
  type ServiceRecord,
} from "./queries";
import { provisionFresh, settleCreateDeployment } from "./redeploy";
import { isUniqueViolation, mapServiceView, normalizePorts, type ServiceView } from "./views";

/**
 * Is this service name already used IN THE TARGET ENVIRONMENT?
 *
 * Scoped deliberately: the unique index is (project, environment, name), so an
 * unscoped check rejected `api` in staging because production owned the name -
 * a collision the database would never have raised.
 *
 * A project with no environment pointer can't be scoped; nothing is "taken"
 * there, and the insert's own unique constraint remains the backstop.
 */
async function serviceNameTaken(
  project: { environmentId: EnvironmentId | null },
  input: { projectId: ProjectId; name: string; environmentId?: EnvironmentId },
): Promise<boolean> {
  const scope = resolveEnvironmentScope(project, input.environmentId);
  if (!scope) return false;
  return (await getServiceRecordByName(input.projectId, input.name, scope)) !== undefined;
}

export async function createService(
  input: CreateServiceInput,
  log: RequestLogger,
): Promise<
  Result<
    ServiceView,
    | ProjectNotFoundError
    | ServiceConflictError
    | MissingServiceBuildBindingError
    | ResolveError
    | UnknownPlacementServerError
  >
> {
  log.set({
    resource: { kind: "service", projectId: input.projectId, name: input.name },
  });

  const projectResult = await loadProject(input);
  if (projectResult.isErr()) return Result.err(projectResult.error);
  const project = projectResult.value;

  if (await serviceNameTaken(project, input)) {
    return Result.err(new ServiceConflictError({ name: input.name }));
  }

  const source = input.source ?? "image";

  if (missingGitBuildBinding(input, source)) {
    return Result.err(new MissingServiceBuildBindingError({ missing: ["gitRepoId"] }));
  }

  // Validate the machine BEFORE the row exists. At deploy an unresolvable pin
  // degrades to "schedule anywhere", which is right for a rollout and wrong
  // for a form the operator just submitted: silently ignoring their choice is
  // how a volume ends up on the wrong disk. See lib/placement-seed.ts.
  const placement = await resolvePlacementSeed({
    serverId: input.placementServerId,
    organizationId: input.organizationId,
  });
  if (placement.isErr()) return Result.err(placement.error);

  const { projectSlug, serviceName, networkName, internalHostname } = deriveServiceNames(
    project.slug,
    input.name,
  );
  const ports = normalizePorts(input.ports);

  let record: ServiceRecord;
  try {
    record = await createServiceRecord(
      toCreateRecordPayload(input, {
        ports,
        serviceName,
        networkName,
        internalHostname,
        placementServerId: placement.value,
      }),
    );
  } catch (error) {
    if (isUniqueViolation(error)) {
      return Result.err(new ServiceConflictError({ name: input.name }));
    }
    throw error;
  }

  // Image-sourced creates deploy right here (no build): record the deployment
  // BEFORE provisioning so the ledger has a row for it (history, logs anchor,
  // rollback anchor) and buildSwarmSpec stamps its id onto the container's
  // labels. Git/upload creates skip this: their row is inserted by the build
  // enqueue (manifest-apply-git / upload-source) when the build actually starts.
  // Compose stacks don't pass through here (reconcileStackServices owns its
  // own per-service rows). The image is prebuilt/pulled: nothing compiles -
  // so the row starts at "pending", not "building".
  const deploysNow = !record.service.image.startsWith("pending:");
  const deploymentRow = deploysNow
    ? await insertDeployment({
        resourceId: record.service.resourceId,
        image: record.service.image,
        reason: "create",
        status: "pending",
        snapshot: { image: record.service.image, source },
      })
    : null;

  const provisioned = await provisionFresh(input.projectId, record, projectSlug, log);
  if (provisioned.isErr()) {
    if (deploymentRow) {
      await markDeploymentFailed(deploymentRow.id, provisioned.error.message).catch(
        () => undefined,
      );
    }
    return Result.err(provisioned.error);
  }
  const runtime = provisioned.value;
  await settleCreateDeployment(
    deploymentRow?.id ?? null,
    record.service.resourceId,
    runtime.status,
    runtime.errorMessage,
  );
  log.set({ provision: { service: serviceName, status: runtime.status } });

  const refreshed = await getServiceRecord(input.projectId, record.service.resourceId);
  return Result.ok(await mapServiceView(refreshed ?? record, projectSlug, runtime));
}
