/**
 * Resolve a collision-free compose stack name for the create wizard.
 *
 * Deploying a template that's already in the project used to overwrite the
 * existing `composes[name]` entry with an identical one — a no-op diff, so the
 * wizard reported success and nothing happened. Instead of failing, we detect
 * the collision live and hand back a unique name (`plausible`, `plausible-2`,
 * …). The name field shows an "already exists" note with the resolved name;
 * stageStack writes under it. Both call this hook, so the shared query cache
 * keeps the indicator and the actual write in lockstep.
 */

import type { ProjectId } from "@otterdeploy/shared/id";

import { useQuery } from "@tanstack/react-query";

import { orpc } from "@/shared/server/orpc";

import { toResourceName } from "./compose-wizard-shared";

export interface UniqueStackName {
  /** The normalized name the operator asked for (input or derived default). */
  base: string;
  /** `base` when free, else `base-2` / `base-3` / … — what stageStack writes. */
  name: string;
  /** True when `base` was already taken and `name` was bumped. */
  collides: boolean;
}

/** First `base`, `base-2`, `base-3`, … not already in `taken`. */
function firstFree(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`.slice(0, 63);
    if (!taken.has(candidate)) return candidate;
  }
}

export function useUniqueStackName(
  projectId: ProjectId,
  rawName: string,
  derivedName: string,
): UniqueStackName {
  // The staged manifest is the source of truth for what names are taken — the
  // graph's pending ghosts come from it too. queryKey/refetch mirror the
  // pending-changes bar so this shares one cache entry, not a second poller.
  const manifest = useQuery(orpc.project.manifest.get.queryOptions({ input: { id: projectId } }));

  const taken = new Set<string>();
  const composes = manifest.data?.manifest?.composes;
  if (composes) {
    for (const key of Object.keys(composes)) taken.add(toResourceName(key));
  }

  const base = toResourceName(rawName.trim() || derivedName);
  const name = firstFree(base, taken);
  return { base, name, collides: name !== base };
}
