/**
 * Delete a compose stack: every child service, the stack's routes, record,
 * host dir, seeded variables and named volumes.
 *
 * Shared by `compose.delete` and `resource.delete`. The generic resource
 * delete used to refuse a stack with NOT_FOUND ("stack deletion is
 * compose.delete's job"), so a client that deletes a project's resources the
 * generic way, the CLI among them, could never delete
 * the stack, and `project.delete` then refused the project for still holding
 * it, leaking the project and its network.
 */
import type { OrganizationId, ProjectId } from "@otterdeploy/shared/id";
import type { RequestLogger } from "evlog";

import { removeResourceDir } from "../../lib/data-dir";
import { removeComposeStack } from "../../swarm";
import { removeComposeFromManifest } from "../project/manifest";
import { cleanupOrphanedComposeVars } from "./cleanup-vars";
import { removeComposeDomains } from "./deploy";
import { type ComposeRecord, deleteComposeRecord } from "./queries";
import { removeStackServices } from "./reconcile";
import { listStoredStackEnvVars } from "./stack-env";
import { reclaimStackVolumes, stackVolumeNames } from "./volumes";

export async function deleteComposeStack(
  rec: ComposeRecord,
  input: {
    projectId: ProjectId;
    organizationId: OrganizationId;
    /** Keep the stack's named volumes (its data) on the host. */
    keepVolumes: boolean;
  },
  log: RequestLogger,
): Promise<void> {
  const resourceId = rec.resource.id;
  // Capture the stack's own variables, as stored, before they cascade away
  // with its record: the legacy project-bag cleanup below compares them.
  const ownVariables = await listStoredStackEnvVars(resourceId);
  // Strip the stack from the manifest FIRST: before any physical teardown.
  // Once a delete is initiated the stack is no longer "desired", so even if
  // a child teardown fails partway, the next diff can only ever show a
  // (recoverable) delete, NEVER a phantom `create` ghost. A deployed stack
  // must never revert to pending-create.
  await removeComposeFromManifest(
    { projectId: input.projectId, organizationId: input.organizationId },
    rec.resource.name,
  );
  // Tear down each child service resource (swarm service + routes + row),
  // then the stack's own routes + record. removeComposeStack also clears any
  // legacy services still labelled with the stack id (pre-real-resource).
  await removeStackServices(resourceId, log);
  await removeComposeStack({ resourceId }, log);
  await removeComposeDomains(resourceId);
  await deleteComposeRecord(input.projectId, resourceId);
  // Drop the stack's host artifact dir (deleteComposeRecord removes the row
  // directly, bypassing deleteResourceById's cleanup). No-op unless the data
  // folder is in use. The dir is env-keyed (null environmentId = main env).
  await removeResourceDir({
    organizationId: input.organizationId,
    projectId: input.projectId,
    environmentId: rec.resource.environmentId ?? null,
    resourceId,
  });
  // Drop the legacy project-bag copies of this stack's variables that
  // nothing else uses. Never a project value the stack did not own.
  await cleanupOrphanedComposeVars(
    { projectId: input.projectId, deletedResourceId: resourceId, ownRows: ownVariables },
    log,
  );
  // Last, after the services are gone: the named volumes. Deterministic
  // names mean a stack re-created under this name would otherwise adopt
  // them, old database password included. Best-effort and retried; the
  // outcome is logged, never raised (the stack is already deleted).
  const volumeNames = stackVolumeNames(rec.compose.services, rec.compose.stackName);
  if (input.keepVolumes) {
    log.set({ composeVolumes: { kept: volumeNames } });
  } else {
    await reclaimStackVolumes(volumeNames, log);
  }
}
