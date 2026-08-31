/**
 * Shared plumbing for the `data.*` handlers: mapping runtime failures onto the
 * contract's errors, resolving whichever kind of target a request names, and
 * the authorization that differs between the two kinds.
 *
 * Split out so the handler file stays readable; the rule that matters — that
 * managed and external targets differ in exactly one place — lives here.
 */
import type { OrganizationId, UserId } from "@otterdeploy/shared/id";

import { ID_PREFIX, hasPrefix } from "@otterdeploy/shared/id";

import type { AccessMode, Connection, DataError } from "../../data";
import type { DataTargetRef } from "./contract";

import { enforceResourceScope } from "../../authz/project-scope-guards";
import { connect, resolveExternalTarget, resolveManagedTarget } from "../../data";

interface DataErrorConstructors {
  NOT_FOUND: () => Error;
  NOT_EDITABLE: (init: { data: { reason: string } }) => Error;
  UNSUPPORTED: (init: { data: { engine: string } }) => Error;
  UNREACHABLE: (init: { data: { reason: string } }) => Error;
  QUERY_FAILED: (init: { data: { reason: string } }) => Error;
  DENIED: (init: { data: { reason: string } }) => Error;
}

export function raise(error: DataError, errors: DataErrorConstructors): Error {
  const reason = error.message;
  switch (error.reason) {
    case "not_found":
      return errors.NOT_FOUND();
    case "unsupported":
      return errors.UNSUPPORTED({ data: { engine: reason } });
    case "unreachable":
    case "timeout":
      return errors.UNREACHABLE({ data: { reason } });
    case "denied":
      return errors.DENIED({ data: { reason } });
    case "query":
      return errors.QUERY_FAILED({ data: { reason } });
  }
}

/**
 * Resolve a target ref and connect, whichever kind it names.
 *
 * The one place the two kinds differ. Above it, every handler is written once:
 * browsing a Neon database and browsing a managed one are the same code path
 * because the difference — where the credentials come from — is settled here.
 */
export async function open(
  context: {
    activeOrganizationId: OrganizationId;
    session?: { user?: { id?: string } } | null;
  },
  target: DataTargetRef,
  mode: AccessMode,
): Promise<Connection> {
  if (target.kind === "resource") {
    return connect(
      await resolveManagedTarget({
        organizationId: context.activeOrganizationId,
        resourceId: target.resourceId,
        mode,
      }),
    );
  }
  return connect(
    await resolveExternalTarget({
      organizationId: context.activeOrganizationId,
      connectionId: target.connectionId,
      viewerId: viewerIdOf(context),
      mode,
    }),
  );
}

/**
 * The acting user's id, or null for an API-key actor.
 *
 * Null is meaningful, not a fallback: an API key has no user, so it can only
 * ever resolve `org`-visible connections. A private connection belongs to the
 * person who saved it and is not reachable by a machine credential.
 */
export function viewerIdOf(context: {
  session?: { user?: { id?: string } } | null;
}): UserId | null {
  const id = context.session?.user?.id;
  // Narrowed with the real prefix guard rather than asserted: the actor's id is
  // a plain string on the session type, and a value that is not a user id must
  // not be allowed to match a `createdBy` column.
  return id !== undefined && hasPrefix(id, ID_PREFIX.user) ? id : null;
}

/**
 * Project-scope enforcement, where it applies.
 *
 * A managed resource belongs to a project, so a member scoped to a subset of
 * projects must not reach one outside it. An external connection has no
 * project — it is org-scoped, and `resolveExternalTarget` already filters by
 * organization and visibility — so there is nothing further to check here, and
 * inventing a project for it would be inventing an authorization answer.
 */
export async function guardTarget(
  context: Parameters<typeof enforceResourceScope>[0],
  target: DataTargetRef,
): Promise<void> {
  if (target.kind === "resource") await enforceResourceScope(context, target.resourceId);
}

/** A log-safe identifier for whichever target was named. */
export function targetLog(target: DataTargetRef) {
  return target.kind === "resource"
    ? { target: { type: "resource" as const, id: target.resourceId } }
    : { dataConnection: { id: target.connectionId } };
}
