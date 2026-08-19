/**
 * Turning a parsed reference into the resource it actually points at.
 *
 * The flat form names its target directly, so a name lookup settles it. The
 * stack-scoped form does not: `${{stack.db.HOST}}` addresses a child by its
 * COMPOSE SERVICE KEY, which is not a resource name and must never be looked
 * up as one — a project holding an unrelated resource genuinely named `db`
 * would otherwise resolve to it, silently, with no error anywhere.
 *
 * Callers that walk a whole project's refs (the graph endpoint, preview DB
 * branching) build the index once and resolve every token against it. The
 * resolver itself doesn't use this: it queries per ref, scoped to a preview.
 *
 * Leaf module by construction — `./parser` is the only import — so anything
 * inside the query-module cycle family can pull it in safely.
 */
import type { RefToken } from "./parser";

/** One project's addressing indexes. Generic over the id type so a caller's
 *  branded `ResourceId` survives the round trip. */
export interface RefIndex<Id extends string = string> {
  /** resource name -> resource id. Names are unique per project. */
  idByName: ReadonlyMap<string, Id>;
  /** service resource id -> owning stack's resource id (children only). */
  stackOfService: ReadonlyMap<string, Id>;
  /** `<stackId>\0<composeKey>` -> the child's resource id. */
  childByStackKey: ReadonlyMap<string, Id>;
  /** resource id -> resource name, for callers whose graph is name-keyed. */
  nameById: ReadonlyMap<Id, string>;
}

/** Compound key for [[RefIndex.childByStackKey]]. `\0` can't occur in either
 *  half, so no separator ambiguity is possible. */
function stackKey(stackId: string, composeService: string): string {
  return `${stackId}\0${composeService}`;
}

export function buildRefIndex<Id extends string>(input: {
  resources: ReadonlyArray<{ id: Id; name: string }>;
  /** `service_resource` rows for the same project. */
  members: ReadonlyArray<{
    resourceId: Id;
    stackId: Id | null;
    composeService: string | null;
  }>;
}): RefIndex<Id> {
  const idByName = new Map<string, Id>();
  const nameById = new Map<Id, string>();
  for (const r of input.resources) {
    idByName.set(r.name, r.id);
    nameById.set(r.id, r.name);
  }

  const stackOfService = new Map<string, Id>();
  const childByStackKey = new Map<string, Id>();
  for (const m of input.members) {
    if (!m.stackId) continue;
    stackOfService.set(m.resourceId, m.stackId);
    // A child predating the `compose_service` column is addressable by name
    // only, until its stack's next reconcile fills the key in.
    if (m.composeService) childByStackKey.set(stackKey(m.stackId, m.composeService), m.resourceId);
  }

  return { idByName, stackOfService, childByStackKey, nameById };
}

/**
 * The resource id `token` addresses, or undefined when it resolves to nothing
 * in this project (a dangling ref, or a self-scoped ref written by a service
 * that isn't in a stack).
 *
 * `sourceServiceId` is the service the ref was written on: the `stack.` self
 * scope means "my own stack", so it can only be resolved relative to it.
 */
export function resolveRefTargetId<Id extends string>(
  token: RefToken,
  sourceServiceId: string,
  index: RefIndex<Id>,
): Id | undefined {
  if (!token.stack) return index.idByName.get(token.resource);
  const stackId =
    token.stack.name === null
      ? index.stackOfService.get(sourceServiceId)
      : index.idByName.get(token.stack.name);
  if (!stackId) return undefined;
  return index.childByStackKey.get(stackKey(stackId, token.resource));
}

/**
 * The resource NAME one ref points at, for callers walking a name-keyed graph.
 *
 * A flat ref passes its own name straight through, so a ref to a resource that
 * no longer exists is still reported as itself. Only the stack-scoped form
 * needs resolving: its first segment is a compose service key, not a name, and
 * reading it as one lands on an unrelated namesake resource.
 */
export function resolveRefTargetName<Id extends string>(
  token: RefToken,
  sourceServiceId: string,
  index: RefIndex<Id>,
): string | undefined {
  if (!token.stack) return token.resource;
  const id = resolveRefTargetId(token, sourceServiceId, index);
  return id ? index.nameById.get(id) : undefined;
}
