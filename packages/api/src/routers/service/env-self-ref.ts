/**
 * The save-time half of the self-reference guard: turns a service record into
 * the identity `findSelfReferences` compares against, and the first hit into
 * the typed error the routers map to a 4xx. Shared by every env write path
 * (service.env.set / bulkSet for the CLI, project.resource.env.bulkSet for the
 * Variables tab) so none of them can drift back to "saved, fails on deploy".
 */
import type { ProjectId, ResourceId } from "@otterdeploy/shared/id";

import { Result } from "better-result";

import { findSelfReferences } from "../../lib/variables/self-ref";
import { RefSelfReferenceError } from "./errors";
import { getStackResourceName } from "./queries/stack";

export interface EnvWriteSubject {
  resource: { name: string };
  service: { stackId?: ResourceId | null; composeService?: string | null };
}

export async function rejectSelfReferences(
  projectId: ProjectId,
  subject: EnvWriteSubject,
  vars: ReadonlyArray<{ key: string; value: string }>,
): Promise<Result<void, RefSelfReferenceError>> {
  // Cheap pre-check so the common case (no references at all) costs no query.
  if (!vars.some((v) => v.value.includes("${{"))) return Result.ok(undefined);
  const stackId = subject.service.stackId ?? null;
  const stackName = stackId ? await getStackResourceName(projectId, stackId) : null;
  const [first] = findSelfReferences(vars, {
    resourceName: subject.resource.name,
    stackName,
    composeService: subject.service.composeService ?? null,
  });
  if (!first) return Result.ok(undefined);
  return Result.err(new RefSelfReferenceError({ key: first.key, raw: first.raw }));
}
