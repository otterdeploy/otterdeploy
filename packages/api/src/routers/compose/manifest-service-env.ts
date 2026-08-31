/**
 * The manifest's per-child env for one stack, ready to seed a materialize.
 *
 * `composes[<stack>].services[<composeKey>].env` (od-uhot). Read at deploy so a
 * stack rebuilt from its manifest — `otd apply` on a fresh install, a DR
 * restore — comes back with the env an operator set on its children, instead
 * of only the compose file's defaults.
 *
 * Best-effort by design: a project with no manifest, an unparseable one, or a
 * stack the manifest does not mention all mean "nothing to seed", which is
 * exactly the behaviour before this existed. A deploy must not fail because a
 * manifest could not be read.
 */
import type { OrganizationId, ProjectId } from "@otterdeploy/shared/id";

import { Result } from "better-result";

import { loadManifest } from "../project/manifest";

export async function loadManifestServiceEnv(
  projectId: ProjectId,
  organizationId: OrganizationId,
  stackName: string,
): Promise<Map<string, Record<string, string>>> {
  const out = new Map<string, Record<string, string>>();
  const row = await Result.tryPromise({
    try: () => loadManifest({ projectId, organizationId }),
    catch: (e: unknown) => e,
  });
  if (row.isErr() || row.value.isErr()) return out;
  const services = row.value.value.manifest?.composes?.[stackName]?.services;
  if (!services) return out;
  for (const [composeKey, entry] of Object.entries(services)) {
    if (entry?.env && Object.keys(entry.env).length > 0) out.set(composeKey, entry.env);
  }
  return out;
}
