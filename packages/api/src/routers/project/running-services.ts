/**
 * How many service/compose resources per project have a live container right
 * now. Split out of projects.ts to keep that file under the line cap.
 */

import type { ProjectId } from "@otterdeploy/shared/id";

import { Docker } from "@otterdeploy/docker";
import { canonicalId } from "@otterdeploy/shared/id";
import { withTimeout } from "@otterdeploy/shared/promise";

import type { OrgRef } from "../scopes";

import { listServiceResourceRefsByOrg } from "./queries";

/**
 * How many service/compose resources per project have a live container right
 * now — one grouped `docker ps` over managed containers, matched to the org's
 * service/compose resources by the `otterdeploy.resource.id` label. A compose
 * stack fans out to several containers but is one resource, so it's counted
 * once (the running set is de-duped by resource id). Returns `null` if the
 * runtime can't be reached, so the caller shows configured totals only.
 */
export async function countRunningServicesByProject(
  organizationId: OrgRef["organizationId"],
): Promise<Map<ProjectId, number> | null> {
  const refs = await listServiceResourceRefsByOrg(organizationId);
  if (refs.length === 0) return new Map();
  const projectOfResource = new Map<string, ProjectId>();
  for (const ref of refs) projectOfResource.set(ref.id, ref.projectId);

  let docker: Docker;
  try {
    docker = Docker.fromEnv();
  } catch {
    return null;
  }
  // This sits on the projects-page critical path (project.list awaits it), so
  // it gets the same treatment as an unreachable daemon: answer late → answer
  // null, and the UI hides the running fraction. A healthy daemon responds in
  // tens of milliseconds; five seconds is already pathological.
  let list;
  try {
    list = await withTimeout(
      docker.containers.list({
        all: false, // running only
        filters: { label: ["otterdeploy.managed=true"] },
      }),
      5_000,
      "docker containers.list",
    );
  } catch {
    docker.destroy();
    return null;
  }
  docker.destroy();
  if (list.isErr()) return null;

  const runningResourceIds = new Set<string>();
  for (const c of list.value) {
    const raw = (c as { Labels?: Record<string, string> }).Labels?.["otterdeploy.resource.id"];
    // Old prefix on containers created before the rename; without this they
    // never match a resource and read as not-running.
    const rid = raw ? canonicalId(raw) : raw;
    if (rid && projectOfResource.has(rid)) runningResourceIds.add(rid);
  }

  const counts = new Map<ProjectId, number>();
  for (const rid of runningResourceIds) {
    const pid = projectOfResource.get(rid);
    if (pid === undefined) continue;
    counts.set(pid, (counts.get(pid) ?? 0) + 1);
  }
  return counts;
}
