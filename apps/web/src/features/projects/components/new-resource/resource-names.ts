/**
 * Which resource names a project already uses, for the new-resource wizard.
 *
 * The wizard used to default a service to its repo's name (`it-tools`) even
 * when the project already had one, preview the existing service's public host
 * on Networking and Review, and only refuse after Add, with a toast.
 * Compose stacks already resolved this live
 * (use-unique-stack-name.ts). Services and databases now do too: a name the
 * wizard fills in is bumped to the first free one (`it-tools-2`), and a name
 * the operator types that is taken fails the field inline, so Continue stops
 * on the step where the name is.
 *
 * The staged manifest is the source of truth, the same one the provisioner
 * refuses against (wizard-provisioner.ts): it carries the pending ghosts as
 * well as what is applied.
 */

import type { ProjectId } from "@otterdeploy/shared/id";

import { createContext, useContext } from "react";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Result } from "better-result";

import { orpc } from "@/shared/server/orpc";

/** First `base`, `base-2`, `base-3`, … not already in `taken`. */
export function firstFreeName(base: string, taken: ReadonlySet<string>, maxLength = 63): string {
  if (!base || !taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const suffix = `-${n}`;
    const candidate = `${base.slice(0, maxLength - suffix.length)}${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}

interface ManifestNames {
  services?: Record<string, unknown>;
  databases?: Record<string, unknown>;
}

/** Every service and database name the staged manifest holds. Services and
 *  databases share one name space: each becomes a resource (and a hostname)
 *  in the project. */
export function takenResourceNames(manifest: ManifestNames | null | undefined): Set<string> {
  return new Set([
    ...Object.keys(manifest?.services ?? {}),
    ...Object.keys(manifest?.databases ?? {}),
  ]);
}

/** The service-name field's own cap (schemas/_base.ts). */
export const RESOURCE_NAME_MAX = 48;

export interface ResourceNames {
  /** Names already in the project, as of the latest manifest read. */
  taken: ReadonlySet<string>;
  /** `base`, or the first free `base-N`. Reads the manifest at call time, so
   *  an async default (the repo probe) never resolves against a stale set. */
  free: (base: string) => string;
  /** {@link ResourceNames.free} once the manifest has loaded, for a default
   *  that is already async (the repo probe) and can afford to wait for it. */
  freeLoaded: (base: string) => Promise<string>;
}

const NO_NAMES: ResourceNames = {
  taken: new Set(),
  free: (base) => base,
  freeLoaded: async (base) => base,
};

export const ResourceNamesContext = createContext<ResourceNames>(NO_NAMES);

/** For the wizard's steps: the names their defaults and validators check. */
export function useResourceNamesContext(): ResourceNames {
  return useContext(ResourceNamesContext);
}

/** Owned by the wizard body, which provides it to the steps. Fetching here,
 *  from the first step, means the set is loaded by the time a step seeds a
 *  name. Same query as the pending-changes bar, so it shares that cache. */
export function useResourceNames(projectId: ProjectId): ResourceNames {
  const queryClient = useQueryClient();
  const options = orpc.project.manifest.get.queryOptions({ input: { id: projectId } });
  const manifest = useQuery(options);
  const taken = takenResourceNames(manifest.data?.manifest);
  return {
    taken,
    free: (base) =>
      firstFreeName(
        base,
        takenResourceNames(queryClient.getQueryData(options.queryKey)?.manifest),
        RESOURCE_NAME_MAX,
      ),
    freeLoaded: async (base) => {
      const loaded = await Result.tryPromise(() => queryClient.ensureQueryData(options));
      // A manifest that cannot be read leaves the name as derived; the field's
      // inline check and the provisioner still stand behind it.
      const taken = takenResourceNames(loaded.isOk() ? loaded.value.manifest : undefined);
      return firstFreeName(base, taken, RESOURCE_NAME_MAX);
    },
  };
}

/** The inline check on a name field: a name the project already has. */
export function nameTakenError(
  value: string,
  taken: ReadonlySet<string>,
  noun: "service" | "database",
): string | undefined {
  const name = value.trim();
  if (!taken.has(name)) return undefined;
  return `A ${noun} named ${name} already exists in this project. Try ${firstFreeName(name, taken, RESOURCE_NAME_MAX)}.`;
}

/** Set when the wizard moved its own default off a taken name: the stem it
 *  wanted, for the field to say why the name reads `-2`. */
export function bumpedFrom(
  name: string,
  taken: ReadonlySet<string>,
  edited: boolean,
): string | null {
  if (edited) return null;
  const stem = name.replace(/-\d+$/, "");
  return stem !== name && taken.has(stem) ? stem : null;
}
