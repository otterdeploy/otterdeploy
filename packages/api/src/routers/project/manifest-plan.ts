/**
 * The plan for one environment: the resolved manifest diffed against that
 * environment's resources, with the evidence apply plans with. Shared by the
 * diff endpoint (what the bar shows) and discard (what the bar's Discard
 * drops), so the two can never disagree about what is pending.
 */
import type { ProjectId } from "@otterdeploy/shared/id";

import { Result } from "better-result";

import type { Change, Manifest } from "../../stack/manifest";
import type { SkippedResource } from "./manifest-applied-snapshot";
import type { EnvironmentScopeInput } from "./queries/environment-scope";

import { diffManifest } from "../../stack/manifest";
import { UntracedDeleteError } from "./errors";
import { loadRefTable, makeEnvRefResolver, withStagedServices } from "./manifest-apply-refs";
import { loadEnvironmentApplied } from "./manifest-environment-applied";
import { loadCurrentState } from "./manifest-state";

export async function planEnvironmentChanges(
  projectId: ProjectId,
  scope: EnvironmentScopeInput,
  manifest: Manifest,
): Promise<Change[]> {
  const [current, refTable, applied] = await Promise.all([
    loadCurrentState(projectId, scope),
    loadRefTable(projectId, scope),
    // What THIS environment last applied. Without it every live resource
    // missing from the manifest reads as a pending DELETE, including ones the
    // manifest never owned; with another environment's, a resource that
    // environment applied does.
    loadEnvironmentApplied(scope.environmentId),
  ]);
  // Resolve ${database:…}/${service:…} refs before comparing. Apply stores
  // the RESOLVED value in the env rows, so a raw-text compare surfaced a
  // permanent phantom "update" for every ref-valued declaration. Same
  // staged-service view apply resolves with, so a ref to a service this
  // manifest creates previews as the value it will get.
  const stagedServices = Object.keys(manifest.services).filter((n) => !current.services[n]);
  return diffManifest(manifest, current, {
    resolveEnvValue: makeEnvRefResolver(withStagedServices(refTable, stagedServices)),
    applied: applied.resolved,
  });
}

/** The resources a plan would touch. A variable change belongs to the
 *  resource that declares it. */
export function pendingResources(changes: readonly Change[]): SkippedResource[] {
  const seen = new Map<string, SkippedResource>();
  for (const change of changes) {
    if (change.kind === "no-op") continue;
    const owner = change.details?.owner;
    const parent = change.details?.parent;
    const entry: SkippedResource =
      change.resource === "env" && typeof owner === "string"
        ? { resource: parent === "database" ? "database" : "service", name: owner }
        : { resource: change.resource, name: change.name };
    seen.set(`${entry.resource}:${entry.name}`, entry);
  }
  return [...seen.values()];
}

/**
 * Run an apply, answering a refused untraced delete with the caller's typed
 * error. Anything else propagates as it was.
 */
export async function refusingUntracedDeletes<T>(
  run: () => Promise<T>,
  refuse: (error: UntracedDeleteError) => Error,
): Promise<T> {
  const outcome = await Result.tryPromise({ try: run, catch: (cause) => cause });
  if (outcome.isOk()) return outcome.value;
  if (UntracedDeleteError.is(outcome.error)) throw refuse(outcome.error);
  throw outcome.error;
}
