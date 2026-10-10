/**
 * The roll a domain change owes its service and its dependents, and only that.
 *
 * `DOMAIN` / `PUBLIC_URL` / `DOMAINS` are computed exports derived from the
 * proxy routes (see `serviceExports`), so adding, removing, or re-pointing a
 * host can change what `${{<svc>.PUBLIC_URL}}` resolves to, for this service
 * (a self-reference such as `BETTER_AUTH_URL`) and for every sibling that
 * addresses it. Those containers have to roll to pick the new address up:
 * an app told its own URL at boot keeps advertising the old one otherwise.
 *
 * The handlers used to roll the service and every dependent unconditionally
 * and wait for it before answering: adding a domain to a service nothing
 * references recreated its container and held the request for seconds, a
 * brief outage per domain for no change at all. Now:
 *
 *   1. Before the write, {@link captureAddressEnv} resolves the env of the
 *      service and its transitive dependents (the only services whose env can
 *      mention its address).
 *   2. After the write, {@link rollAddressChangesInBackground} re-resolves
 *      them behind the response and rolls exactly those whose resolved env
 *      changed. Nothing references the address → nothing rolls.
 *
 * Best-effort by design, as before: the domain write is committed and the
 * route is already serving. A roll that cannot happen right now must not turn
 * a successful domain change into an error, and it never holds the response.
 */
import type { ProjectId, ResourceId } from "@otterdeploy/shared/id";

import { Result } from "better-result";
import { log } from "evlog";

import { findTransitiveDependents, resolveServiceEnv } from "../../lib/variables";
import { loadProject } from "./context";
import { type ResourceRef } from "./inputs";
import { getServiceRecord } from "./queries";
import { redeployOne } from "./redeploy";

/** What each candidate's env resolved to before the domain write. `null`
 *  marks an env that did not resolve (it cannot be compared, only rolled if it
 *  resolves now). */
export interface AddressEnvSnapshot {
  projectId: ProjectId;
  resourceId: ResourceId;
  before: ReadonlyMap<ResourceId, string | null>;
}

/** A comparable form of a resolved env: key order is not meaningful. */
async function fingerprint(projectId: ProjectId, resourceId: ResourceId): Promise<string | null> {
  const resolved = await resolveServiceEnv(projectId, resourceId);
  if (resolved.isErr()) return null;
  const entries = Object.entries(resolved.value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return JSON.stringify(entries);
}

/** The service first, then every service that references it (directly or
 *  through another service's exported var). */
async function candidatesOf(projectId: ProjectId, resourceId: ResourceId): Promise<ResourceId[]> {
  const record = await getServiceRecord(projectId, resourceId);
  if (!record) return [];
  const dependents = await findTransitiveDependents({
    projectId,
    targetResourceId: resourceId,
    targetResourceName: record.resource.name,
  });
  return [resourceId, ...dependents];
}

/** Step 1: call BEFORE the domain write. */
export async function captureAddressEnv(input: ResourceRef): Promise<AddressEnvSnapshot> {
  const before = new Map<ResourceId, string | null>();
  for (const id of await candidatesOf(input.projectId, input.resourceId)) {
    before.set(id, await fingerprint(input.projectId, id));
  }
  return { projectId: input.projectId, resourceId: input.resourceId, before };
}

/**
 * Step 2, awaited form: re-resolve and roll every candidate whose env changed.
 * Returns the services it rolled, in order.
 */
export async function rollAddressChanges(
  input: ResourceRef,
  snapshot: AddressEnvSnapshot,
): Promise<ResourceId[]> {
  // Read after the write: a dependent added meanwhile has no "before", and a
  // service only now able to resolve counts as changed.
  const candidates = await candidatesOf(input.projectId, input.resourceId);
  const changed: ResourceId[] = [];
  for (const id of candidates) {
    const after = await fingerprint(input.projectId, id);
    const before = snapshot.before.get(id) ?? null;
    if (after !== null && after !== before) changed.push(id);
  }
  if (changed.length === 0) return [];

  const project = await loadProject(input);
  if (project.isErr()) return [];
  const rolled: ResourceId[] = [];
  for (const id of changed) {
    const result = await redeployOne(input.projectId, id, project.value.slug);
    rolled.push(id);
    if (result.isErr()) {
      log.warn({
        domainRepublish: { resourceId: id, error: result.error.message },
      });
    }
  }
  log.info({ domainRepublish: { resourceId: input.resourceId, rolled } });
  return rolled;
}

/** Rolls in flight, so tests (and shutdown) can wait for them. */
const inFlight = new Set<Promise<unknown>>();

/** Step 2: what the handlers call after the write. Never awaited by the
 *  response, never rejects. */
export function rollAddressChangesInBackground(
  input: ResourceRef,
  snapshot: AddressEnvSnapshot,
): void {
  const run = Result.tryPromise({
    try: () => rollAddressChanges(input, snapshot),
    catch: (cause) => (cause instanceof Error ? cause.message : String(cause)),
  }).then((outcome) => {
    if (outcome.isErr()) {
      log.error({ domainRepublish: { resourceId: input.resourceId, error: outcome.error } });
    }
  });
  inFlight.add(run);
  void run.finally(() => inFlight.delete(run));
}

/** Resolves once every background roll has finished. For tests. */
export async function addressRollsIdle(): Promise<void> {
  while (inFlight.size > 0) await Promise.all(inFlight);
}
