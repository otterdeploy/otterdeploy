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
import {
  resolveNewResourceEnvironment,
  type ResourceEnvironmentNotFoundError,
} from "../project/queries/new-resource-environment";
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
import { provisionFresh } from "./redeploy";
import { checkRolloutResolvable, startRollout } from "./rollout";
import {
  isUniqueViolation,
  mapServiceView,
  normalizePorts,
  type ServiceMutationView,
} from "./views";

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
  input: { projectId: ProjectId; name: string },
  environmentId: EnvironmentId | null,
): Promise<boolean> {
  const scope = resolveEnvironmentScope(project, environmentId);
  if (!scope) return false;
  return (await getServiceRecordByName(input.projectId, input.name, scope)) !== undefined;
}

export async function createService(
  input: CreateServiceInput,
  log: RequestLogger,
): Promise<
  Result<
    ServiceMutationView,
    | ProjectNotFoundError
    | ServiceConflictError
    | MissingServiceBuildBindingError
    | ResolveError
    | UnknownPlacementServerError
    | ResourceEnvironmentNotFoundError
  >
> {
  log.set({
    resource: { kind: "service", projectId: input.projectId, name: input.name },
  });

  const projectResult = await loadProject(input);
  if (projectResult.isErr()) return Result.err(projectResult.error);
  const project = projectResult.value;

  // The environment comes first: a name check against an environment that is
  // not this project's would answer a question about someone else's rows, and
  // the insert must never stamp a foreign id. Omitted means main.
  const environment = await resolveNewResourceEnvironment(input.projectId, input.environmentId);
  if (environment.isErr()) return Result.err(environment.error);

  if (await serviceNameTaken(project, input, environment.value)) {
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
        environmentId: environment.value,
      }),
    );
  } catch (error) {
    if (isUniqueViolation(error)) {
      return Result.err(new ServiceConflictError({ name: input.name }));
    }
    throw error;
  }

  // Git/upload creates sit on a placeholder image until their first build:
  // nothing to roll, and their row is inserted by the build enqueue.
  if (record.service.image.startsWith("pending:")) {
    const provisioned = await provisionFresh(input.projectId, record, projectSlug, log);
    if (provisioned.isErr()) return Result.err(provisioned.error);
    const refreshed = await getServiceRecord(input.projectId, record.service.resourceId);
    const view = await mapServiceView(refreshed ?? record, projectSlug, provisioned.value);
    return Result.ok({ ...view, deploymentId: null });
  }

  // Image-sourced creates deploy now, off the request (./rollout.ts): the
  // health-gated first start can outlast the request's deadline. The row is
  // recorded first (history, logs anchor, rollback anchor, and the id
  // buildSwarmSpec stamps onto the container) and its id is the answer; the
  // outcome lands on it. A broken env reference is still refused here.
  const resolvable = await checkRolloutResolvable(input.projectId, record.service.resourceId);
  if (resolvable.isErr()) return Result.err(resolvable.error);
  const deploymentId = await startRollout({
    kind: "create",
    projectId: input.projectId,
    organizationId: input.organizationId,
    resourceId: record.service.resourceId,
    reason: "create",
    image: record.service.image,
    snapshot: { image: record.service.image, source },
    fanOut: false,
    log,
  });
  log.set({ provision: { service: serviceName, deploymentId } });

  const refreshed = await getServiceRecord(input.projectId, record.service.resourceId);
  // Honest about the moment: the first version is starting, not yet up.
  const view = await mapServiceView(refreshed ?? record, projectSlug, {
    serviceId: null,
    serviceName,
    networkName,
    status: "starting",
    health: null,
  });
  return Result.ok({ ...view, deploymentId });
}
